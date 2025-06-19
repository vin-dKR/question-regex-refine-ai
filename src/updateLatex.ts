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
        {
            role: 'system',
            content: 'You are a LaTeX formatting expert. Your job is to find and correctly wrap all LaTeX/math expressions using inline LaTeX delimiters.'
        },
        {
            role: 'user',
            content: `
Your task is to format LaTeX expressions in the provided question data. Use inline math delimiters only: \\(...\\)

✅ Rules:
1. Detect all LaTeX or math expressions — such as fractions, square roots, Greek letters, subscripts, superscripts, equations, symbols, etc.
2. Wrap ONLY the math expressions using inline math delimiters: \\(...\\)
3. DO NOT wrap full sentences — only the math parts.
4. Replace any other math delimiters like \`$\`, \`$.....$\`, \`\\[....\\]\`, \`[....]\`, etc. with \\(...\\)
5. Do NOT alter or add/remove any text or content — only wrap the math where necessary.
6. Preserve spacing, punctuation, and formatting outside math expressions.

🧪 Input:
question_text: ${text}
answer: ${answer}
options: ${JSON.stringify(options)}

🎯 Output format (valid JSON):
{
  "question_text": "...",
  "answer": "...",
  "options": ["...", "...", "...", "..."]
}

Example: For every math expression, wrap it in \\(...\\). For example:
- Input: The value is 2x + 3.
- Output: The value is \\(2x + 3\\).

- Input: The answer is 4.12 \times 10^{-15} V s.
- Output: The answer is \\(4.12 \times 10^{-15} V s\\).
      `.trim(),
        },
    ];

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4.1-mini',
            messages: prompt,
            temperature: 0.1,
        });

        const formattedContent = response.choices[0]?.message?.content;
        if (formattedContent) {
            // Remove markdown code block delimiters if present
            let cleanContent = formattedContent.replace(/^```json\n/, '').replace(/\n```$/, '');

            // Fix bad escaped characters: replace single backslashes with double backslashes for JSON parsing
            cleanContent = cleanContent.replace(/\\(?!\\)/g, '\\\\');

            try {
                const parsed = JSON.parse(cleanContent);
                console.log('AI raw response:', formattedContent);
                console.log('Parsed/extracted:', { question_text: parsed.question_text, answer: parsed.answer, options: parsed.options });
                return { question_text: parsed.question_text, answer: parsed.answer, options: parsed.options };
            } catch (jsonErr) {
                // Fallback: Try to extract fields using regex if JSON parsing fails
                console.warn('JSON parse failed, attempting regex extraction...');
                // Try to extract question_text
                const qMatch = cleanContent.match(/question_text\s*[:=]\s*["']([\s\S]*?)["']\s*,?\s*answer[:=]/i);
                const aMatch = cleanContent.match(/answer\s*[:=]\s*["']([\s\S]*?)["']\s*,?\s*options[:=]/i);
                const oMatch = cleanContent.match(/options\s*[:=]\s*(\[[\s\S]*?\])/i);
                let question_text = qMatch ? qMatch[1].trim() : text;
                let answerText = aMatch ? aMatch[1].trim() : answer;
                let optionsArr: string[] = options;
                if (oMatch) {
                    try {
                        // Try to parse the options array
                        optionsArr = JSON.parse(oMatch[1].replace(/\\(?!\\)/g, '\\\\'));
                    } catch (e) {
                        // Fallback: try to split manually
                        optionsArr = oMatch[1]
                            .replace(/^[\[]|[\]]$/g, '')
                            .split(',')
                            .map(opt => opt.replace(/^\s*["']|["']\s*$/g, '').trim());
                    }
                }
                const formatted = { question_text, answer: answerText, options: optionsArr };
                console.log('Updating DB with:', formatted);
                return formatted;
            }
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
                    {
                        $set: {
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
            console.log('------------------------------');

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
