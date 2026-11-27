require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
const { PDFParse } = require('pdf-parse');

const app = express();
const port = process.env.PORT || 3000;

// Configure multer for in-memory file uploads (max 10MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Fixed active working model
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

// Helper to extract text from a PDF Buffer using pdf-parse v2
async function extractTextFromPdf(buffer) {
  try {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    const text = result?.text?.trim() || '';
    return { success: true, text };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to parse PDF file.' };
  }
}

// Helper to categorize and format Gemini API errors
function formatGeminiError(err) {
  const msg = err.message || String(err);
  const status = err.status || err.statusCode || (err.error && err.error.code) || 500;

  if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid') || status === 401 || status === 403) {
    return {
      status: 401,
      type: 'INVALID_API_KEY',
      userMessage: 'Invalid Gemini API key. Please check your GEMINI_API_KEY in the .env file.'
    };
  }

  if (msg.includes('RESOURCE_EXHAUSTED') || status === 429) {
    return {
      status: 429,
      type: 'QUOTA_EXHAUSTED',
      userMessage: 'Gemini API quota or rate limit exceeded. Please wait a moment or check your quota.'
    };
  }

  if (msg.includes('NOT_FOUND') || msg.includes('is not found') || status === 404) {
    return {
      status: 404,
      type: 'MODEL_NOT_FOUND',
      userMessage: `Model "${MODEL_NAME}" was not found or is not accessible with this API key.`
    };
  }

  return {
    status: typeof status === 'number' && status >= 400 && status < 600 ? status : 500,
    type: 'GEMINI_API_ERROR',
    userMessage: `Gemini API Error: ${msg}`
  };
}

// Route 1: Get backend status and configured model
app.get('/api/status', (req, res) => {
  const hasKey = !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
  res.json({
    apiKeyConfigured: hasKey,
    model: MODEL_NAME
  });
});

// Route 2: Test basic Gemini API connection
// Must send prompt "Reply with exactly: GEMINI_OK" and return actual response
app.post('/api/test-connection', async (req, res) => {
  const apiKey = (req.body.apiKey && req.body.apiKey.trim()) || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(400).json({
      success: false,
      errorType: 'MISSING_API_KEY',
      error: 'Gemini API key is missing. Set GEMINI_API_KEY in your .env file or enter it in the interface.'
    });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: 'Reply with exactly: GEMINI_OK'
    });

    const reply = response.text ? response.text.trim() : '';
    return res.json({
      success: true,
      message: reply,
      model: MODEL_NAME,
      status: 'Connected'
    });
  } catch (err) {
    const errInfo = formatGeminiError(err);
    return res.status(errInfo.status).json({
      success: false,
      errorType: errInfo.type,
      error: errInfo.userMessage,
      details: err.message,
      model: MODEL_NAME
    });
  }
});

// Route 3: Core resume analysis & skill gap analysis endpoint
app.post('/api/analyze', upload.single('resumeFile'), async (req, res) => {
  const apiKey = (req.body.apiKey && req.body.apiKey.trim()) || process.env.GEMINI_API_KEY;
  const occupation = (req.body.occupation || '').trim();
  const location = (req.body.location || '').trim();

  // Validate API Key
  if (!apiKey) {
    return res.status(400).json({
      success: false,
      errorType: 'MISSING_API_KEY',
      error: 'Gemini API key is missing. Please configure GEMINI_API_KEY in your .env file or enter it in the interface.'
    });
  }

  // Validate Desired Occupation
  if (!occupation) {
    return res.status(400).json({
      success: false,
      errorType: 'MISSING_OCCUPATION',
      error: 'Desired occupation is required. Please enter an occupation (e.g., Data Analyst, Solar Panel Technician).'
    });
  }

  // Extract resume text from PDF or pasted input
  let resumeText = '';
  let resumeSource = '';
  let filename = null;

  if (req.file) {
    filename = req.file.originalname;
    resumeSource = 'pdf_upload';

    const isPdf = req.file.mimetype === 'application/pdf' || req.file.originalname.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      return res.status(400).json({
        success: false,
        errorType: 'INVALID_FILE_TYPE',
        error: 'Uploaded file is not a PDF. Please upload a valid .pdf file or paste resume text.'
      });
    }

    const pdfExtraction = await extractTextFromPdf(req.file.buffer);
    if (!pdfExtraction.success) {
      return res.status(400).json({
        success: false,
        errorType: 'PDF_PARSE_FAILED',
        error: `Could not parse the PDF file: ${pdfExtraction.error}`
      });
    }

    resumeText = pdfExtraction.text;

    if (!resumeText || resumeText.replace(/\s+/g, '').length < 30) {
      return res.status(400).json({
        success: false,
        errorType: 'SCANNED_PDF_NO_TEXT',
        error: 'The uploaded PDF appears to be a scanned image or contains no extractable text. Please paste the resume text into the text area or upload a text-based PDF.'
      });
    }
  } else if (req.body.resumeText && req.body.resumeText.trim()) {
    resumeSource = 'pasted_text';
    resumeText = req.body.resumeText.trim();

    if (resumeText.replace(/\s+/g, '').length < 20) {
      return res.status(400).json({
        success: false,
        errorType: 'EMPTY_RESUME',
        error: 'The pasted resume text is too short. Please provide a complete resume.'
      });
    }
  } else {
    return res.status(400).json({
      success: false,
      errorType: 'NO_RESUME_PROVIDED',
      error: 'No resume provided. Please either upload a PDF resume or paste resume text.'
    });
  }

  // Build the prompt for PMKVY skill gap analysis
  const systemPrompt = `You are an AI-powered career and skill development assistant for the Government of India's PMKVY (Pradhan Mantri Kaushal Vikas Yojana) skill ecosystem.

You have been provided with a candidate's resume, desired occupation, and preferred location.

Your tasks are:
1. Analyze the resume and extract the candidate's actual technical skills, soft skills, educational qualifications, work experience, projects, and certifications. Do not invent information not supported by the resume.
2. Identify the core competencies and benchmark skills required for the desired occupation, referencing official National Qualification Register (NQR) and National Skill Development Corporation (NSDC) job roles.
3. Compare the candidate's existing competencies against the required competencies for the role.
4. Conduct a detailed Skill Gap Analysis:
   - Possessed Competencies: Skills the candidate demonstrates adequately.
   - Partially Demonstrated Competencies: Areas where the candidate has foundation knowledge but lacks depth or hands-on proficiency.
   - Missing Competencies: Key mandatory skills entirely absent from the profile.
   - Explanation of Gaps: Clear explanation for each critical gap.
5. Provide actionable guidance on relevant PMKVY job roles / National Skills Qualifications Framework (NSQF) course qualifications and skill development pathways to bridge these gaps.

Return your response in clearly structured sections with readable headings:
Section 1: Candidate Profile & Extracted Skills
Section 2: Benchmark Competencies for Desired Occupation
Section 3: Comprehensive Skill Gap Analysis (Possessed, Partially Demonstrated, Missing Skills)
Section 4: Skill Gap Impact & Detailed Explanations
Section 5: Recommended PMKVY / NSQF Qualifications & Next Steps`;

  const userPrompt = `CANDIDATE DETAILS:
- Desired Occupation: ${occupation}
- Preferred Location: ${location || 'India (General)'}

CANDIDATE RESUME:
---
${resumeText}
---

Please execute the complete resume analysis and skill gap assessment for ${occupation} following the structured sections.`;

  try {
    const ai = new GoogleGenAI({ apiKey });

    // Official generateContent call using gemini-3.5-flash-lite
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `${systemPrompt}\n\n${userPrompt}`,
      config: {
        temperature: 0.2
      }
    });

    const candidate = response.candidates?.[0];
    const outputText = response.text || candidate?.content?.parts?.map(p => p.text).join('') || '';

    return res.json({
      success: true,
      analysis: outputText,
      debug: {
        geminiStatus: 'Connected',
        model: MODEL_NAME,
        groundingToolEnabled: false,
        resumeExtraction: {
          success: true,
          source: resumeSource,
          filename: filename,
          characterCount: resumeText.length
        }
      }
    });

  } catch (err) {
    const errInfo = formatGeminiError(err);
    return res.status(errInfo.status).json({
      success: false,
      errorType: errInfo.type,
      error: errInfo.userMessage,
      details: err.message,
      debug: {
        geminiStatus: 'Error',
        model: MODEL_NAME,
        groundingToolEnabled: false,
        resumeExtraction: {
          success: true,
          source: resumeSource,
          filename: filename,
          characterCount: resumeText.length
        }
      }
    });
  }
});

// Start Express server
app.listen(port, () => {
  console.log(`PMKVY Skill Gap Analyzer PoC server running at http://localhost:${port} using model: ${MODEL_NAME}`);
});
