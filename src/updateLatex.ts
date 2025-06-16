import { config } from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';
import OpenAI from 'openai';
import { type ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { setTimeout } from 'timers/promises';

// Define LaTeX delimiters for clarity and correct escaping in prompt
const LATEX_OPEN_DELIMITER = '\\('; // Renders as \( in the final string sent to AI
const LATEX_CLOSE_DELIMITER = '\\)'; // Renders as \) in the final string sent to AI

// Load environment variables
config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// MongoDB connection
const mongoUri = process.env.MONGODB_URI;

if (!mongoUri) {
  console.error('MONGODB_URI is not defined in the .env file');
  process.exit(1);
}

const client = new MongoClient(mongoUri);

interface Question {
  _id?: ObjectId;
  question_number: number;
  file_name: string;
  question_text: string;
  isQuestionImage: boolean;
  question_image: string | null;
  isOptionImage: boolean;
  options: string[];
  option_images: string[];
  section_name: string;
  question_type: string;
  topic: string | null;
  exam_name: string;
  subject: string;
  chapter: string;
  answer: string | null;
  flagged: boolean | null;
}

async function getChapters(): Promise<string[]> {
  await client.connect();
  const db = client.db('banks');
  const questionsCollection = db.collection<Question>('Question');
  const chapters = await questionsCollection.distinct('chapter');
  return chapters.filter(c => c !== null) as string[]; // Filter out null chapters
}

async function formatLatexWithAI(text: string, answer: string, options: string[]): Promise<{ question_text: string, answer: string, options: string[] } | null> {
    const prompt: ChatCompletionMessageParam[] = [
      { role: 'system', content: 'You are an expert at LaTeX formatting. Your task is to fix LaTeX/mathematical expressions in question data.' },
      {
        role: 'user',
        content: `Wrap all LaTeX/math expressions inside the inline math delimiter \\(...\\) so they render correctly.\nAny raw or improperly wrapped LaTeX should be correctly enclosed within \\(...\\).\n\nRules:\n1. Do NOT wrap the entire sentence — only wrap the math expressions\n2. If the math is already wrapped with brackets [ ], dollar signs $...$, or any other delimiter, replace it with \\(...\\)\n3. Don't add or remove any content — just wrap correctly\n\nInput:\nquestion_text: ${text}\nanswer: ${answer}\noptions: ${JSON.stringify(options)}\n\nReturn the formatted question_text, answer, and options in JSON format.`,
      },
    ];
  
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4-turbo-preview', // Or 'gpt-3.5-turbo' if preferred
        messages: prompt,
        temperature: 0.1,
      });
  
      const formattedContent = response.choices[0]?.message?.content;
      if (formattedContent) {
        // Remove markdown code block delimiters if present
        let cleanContent = formattedContent.replace(/^```json\n/, '').replace(/\n```$/, '');
  
        // Fix bad escaped characters: replace single backslashes with double backslashes for JSON parsing
        // This regex matches a single backslash that is NOT followed by another backslash.
        // For example, it converts '\(' to '\\(' and '\alpha' to '\\alpha'.
        cleanContent = cleanContent.replace(/\\(?!\\)/g, '\\\\');
  
        // Diagnostic logs - CRITICAL FOR DEBUGGING JSON PARSING ISSUES
        console.log(`--- Raw Content from AI for QID: ${text.substring(0, 50)}... ---\n${formattedContent}`);
        console.log(`--- Cleaned Content before JSON.parse for QID: ${text.substring(0, 50)}... ---\n${cleanContent}`);
  
        const parsed = JSON.parse(cleanContent);
        return { question_text: parsed.question_text, answer: parsed.answer, options: parsed.options };
      }
      return null;
    } catch (e: any) {
      console.error(`Error formatting with AI: ${e.message}`);
      return null;
    }
  }
  

async function updateQuestionsByChapter(chapter: string): Promise<void> {
  const db = client.db('banks');
  const questionsCollection = db.collection<Question>('Question');

  // Fetch all questions for the chapter upfront to avoid cursor timeouts
  const questions = await questionsCollection.find({ chapter }).toArray();
  const totalQuestions = questions.length;

  console.log(`\nProcessing chapter: ${chapter} (${totalQuestions} questions)`);

  let processedCount = 0;
  for (const question of questions) { // Iterate over array, not cursor
    try {
      const formatted = await formatLatexWithAI(
        question.question_text,
        question.answer || '',
        question.options || []
      );

      if (formatted) {
        await questionsCollection.updateOne(
          { _id: question._id },
          { $set: {
              question_text: formatted.question_text,
              answer: formatted.answer,
              options: formatted.options
            }
          }
        );
        console.log(`SUCCESS: Processed question ${question._id}`);
      } else {
        console.log(`ERROR: Formatting failed for question ${question._id} (AI returned null/empty)`);
      }
      // No need for process.stdout.write for progress bar if logging each ID

      // Add a small delay to avoid rate limiting
      await setTimeout(500); // 500ms delay

    } catch (e: any) {
      console.error(`ERROR: Question ${question._id} - ${e.message}`);
      // Continue to next question even if one fails
    }
  }
  console.log(`\nCompleted processing chapter: ${chapter}`);
}

async function main(): Promise<void> {
  try {
    const chapters = await getChapters();
    console.log(`Found ${chapters.length} chapters to process`);

    for (const chapter of chapters) {
      if (chapter) { // Ensure chapter is not null or undefined
        await updateQuestionsByChapter(chapter);
      }
    }
  } catch (error: any) {
    console.error(`Failed to get chapters or process questions: ${error.message}`);
    process.exit(1);
  } finally {
    await client.close();
    console.log('MongoDB connection closed.');
  }
}

main().catch(console.error); 