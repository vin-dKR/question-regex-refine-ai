# Question Database LaTeX Updater

This project provides a TypeScript script to automate the formatting of LaTeX/mathematical expressions within a MongoDB question database. It leverages OpenAI's API to intelligently identify and wrap raw or improperly formatted LaTeX code in `\(...\)` delimiters, ensuring proper rendering on the frontend.

## Features

- Connects to a MongoDB database to fetch question data.
- Processes questions chapter by chapter for organized updates.
- Utilizes OpenAI's GPT-4 for accurate LaTeX formatting.
- Updates `question_text`, `answer`, and `options` fields.
- Includes progress indicators and error handling.

## Setup and Installation

1.  **Clone the repository:**
    ```bash
    git clone <repository_url>
    cd question-db-update
    ```

2.  **Install Node.js dependencies:**
    ```bash
    npm install
    ```

3.  **Configure Environment Variables:**
    Create a `.env` file in the root directory of the project and add your sensitive credentials:
    ```
    OPENAI_API_KEY="your_openai_api_key_here"
    MONGODB_URI="your_mongodb_connection_string_here"
    ```
    Replace `"your_openai_api_key_here"` with your actual OpenAI API key and `"your_mongodb_connection_string_here"` with your MongoDB Atlas connection string. **Do not commit this file to version control.**

## Usage

To run the script and start the LaTeX formatting process:

```bash
npx ts-node src/updateLatex.ts
```

The script will iterate through chapters in your database, fetch questions, apply LaTeX formatting via OpenAI, and update the database. Progress and detailed logs for each question will be displayed in the terminal.

## Project Structure

```
question-db-update/
├── node_modules/           # Node.js dependencies (ignored by Git)
├── dist/                   # Compiled JavaScript output (ignored by Git)
├── .gitignore              # Specifies files/directories to ignore in Git
├── package.json            # Node.js project metadata and dependencies
├── tsconfig.json           # TypeScript compiler configuration
├── src/                    # Source code directory
│   └── updateLatex.ts      # Main script for LaTeX formatting and DB updates
└── .env                    # Environment variables (ignored by Git)
```
