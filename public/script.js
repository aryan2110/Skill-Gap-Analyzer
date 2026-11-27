// PMKVY Skill Gap Analyzer - Client Application Logic

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const statusBanner = document.getElementById('statusBanner');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const activeModelBadge = document.getElementById('activeModelBadge');
  const testConnBtn = document.getElementById('testConnBtn');
  const loadSampleBtn = document.getElementById('loadSampleBtn');
  
  const form = document.getElementById('analyzerForm');
  const resumeFile = document.getElementById('resumeFile');
  const resumeText = document.getElementById('resumeText');
  const occupationInput = document.getElementById('occupation');
  const locationInput = document.getElementById('location');
  const submitBtn = document.getElementById('submitBtn');
  
  const loadingIndicator = document.getElementById('loadingIndicator');
  const resultsSection = document.getElementById('resultsSection');
  const formattedOutput = document.getElementById('formattedOutput');
  const rawOutput = document.getElementById('rawOutput');
  const toggleRawBtn = document.getElementById('toggleRawBtn');
  const copyResultsBtn = document.getElementById('copyResultsBtn');
  
  // Debug fields
  const debugStatus = document.getElementById('debugStatus');
  const debugModel = document.getElementById('debugModel');
  const debugTestReply = document.getElementById('debugTestReply');
  const debugResumeExtraction = document.getElementById('debugResumeExtraction');

  let currentResponseText = '';

  // 1. Check Server Status on Load
  checkServerStatus();

  async function checkServerStatus() {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        const modelName = data.model || 'gemini-3.5-flash-lite';
        debugModel.textContent = modelName;
        activeModelBadge.textContent = modelName;
        
        if (data.apiKeyConfigured) {
          debugStatus.textContent = 'Key Configured (.env)';
          debugStatus.className = 'debug-val status-ok';
        } else {
          debugStatus.textContent = 'No Key in .env';
          debugStatus.className = 'debug-val status-unknown';
          showBanner('Notice: GEMINI_API_KEY is not configured in .env. Enter it above or set it in .env.', 'banner-info');
        }
      }
    } catch (err) {
      debugStatus.textContent = 'Backend Offline';
      debugStatus.className = 'debug-val status-err';
      showBanner('Cannot connect to backend server. Ensure "node server.js" is running.', 'banner-error');
    }
  }

  function showBanner(message, type = 'banner-info') {
    statusBanner.className = `banner ${type}`;
    statusBanner.textContent = message;
    statusBanner.classList.remove('hidden');
  }

  function hideBanner() {
    statusBanner.classList.add('hidden');
    statusBanner.textContent = '';
  }

  // 2. Test Connection (Prompt: "Reply with exactly: GEMINI_OK")
  testConnBtn.addEventListener('click', async () => {
    hideBanner();
    testConnBtn.disabled = true;
    testConnBtn.textContent = 'Testing...';
    debugStatus.textContent = 'Testing...';
    debugStatus.className = 'debug-val status-unknown';
    debugTestReply.textContent = '...';

    try {
      const res = await fetch('/api/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKeyInput.value.trim()
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        debugStatus.textContent = 'Connected (200 OK)';
        debugStatus.className = 'debug-val status-ok';
        debugModel.textContent = data.model || 'gemini-3.5-flash-lite';
        debugTestReply.textContent = data.message;
        showBanner(`Connection Successful! Actual Gemini response: "${data.message}"`, 'banner-success');
      } else {
        debugStatus.textContent = 'Connection Failed';
        debugStatus.className = 'debug-val status-err';
        debugTestReply.textContent = 'Failed';
        showBanner(`Connection Test Failed: ${data.error || 'Unknown error'}`, 'banner-error');
      }
    } catch (err) {
      debugStatus.textContent = 'Network Error';
      debugStatus.className = 'debug-val status-err';
      debugTestReply.textContent = 'Error';
      showBanner(`Connection error: ${err.message}`, 'banner-error');
    } finally {
      testConnBtn.disabled = false;
      testConnBtn.textContent = 'Test Gemini Connection';
    }
  });

  // 3. Load Sample Candidate Data
  loadSampleBtn.addEventListener('click', () => {
    resumeFile.value = '';
    resumeText.value = `HARPREET SINGH
Ludhiana, Punjab | harpreet.singh@email.com | +91 98765 43210

OBJECTIVE:
Enthusiastic graduate with practical knowledge in database management, basic spreadsheet analysis, and Python seeking entry-level employment as a Data Analyst or Junior MIS Executive.

EDUCATION:
- Bachelor of Science in Information Technology (B.Sc. IT), 2024
  Punjab Technical University, Ludhiana (CGPA: 7.4/10)
- Higher Secondary Education (12th Non-Medical), 2021
  PSEB Board, Ludhiana (78%)

TECHNICAL SKILLS:
- Languages: Python (Pandas basics, basic loops, functions), SQL (SELECT queries, JOINS, GROUP BY)
- Tools & Software: Microsoft Excel (VLOOKUP, Pivot Tables, basic formulas), MySQL, MS Office Suite
- Basic Concepts: Data cleaning, exploratory data analysis, statistics basics

PROJECTS:
1. Retail Sales Analysis Project (Academic):
   - Analyzed retail store sales CSV data using Python Pandas and Excel.
   - Summarized monthly revenue, top-selling categories, and visualized sales trends with Matplotlib.
2. Library Management System:
   - Designed relational database schema in MySQL for student book issuance and automated late fee queries.

EXPERIENCE:
- Computer Lab Assistant (Part-time, 6 months)
  Assisted students with basic software troubleshooting and maintained student attendance registers in MS Excel.

CERTIFICATIONS:
- Certificate Course in Microsoft Excel Basics (30 Hours)
- Introduction to Python Programming (Online Course)`;

    occupationInput.value = 'Data Analyst';
    locationInput.value = 'Ludhiana, Punjab, India';
    showBanner('Sample candidate profile loaded! Click "Analyze Resume & Find PMKVY Courses" to run the PoC.', 'banner-info');
  });

  // File input change notice
  resumeFile.addEventListener('change', () => {
    if (resumeFile.files.length > 0) {
      resumeText.placeholder = `(PDF File selected: ${resumeFile.files[0].name}. Paste text here only if you want to override the file.)`;
    }
  });

  // 4. Submit Form: Full Resume Analysis & Skill Gap Assessment
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideBanner();

    const file = resumeFile.files[0];
    const text = resumeText.value.trim();
    const occupation = occupationInput.value.trim();
    const location = locationInput.value.trim();

    if (!file && !text) {
      showBanner('Please upload a PDF resume or paste resume text before submitting.', 'banner-error');
      return;
    }

    if (!occupation) {
      showBanner('Please provide a desired occupation.', 'banner-error');
      return;
    }

    // Prepare FormData
    const formData = new FormData();
    if (file) {
      formData.append('resumeFile', file);
    }
    if (text) {
      formData.append('resumeText', text);
    }
    formData.append('occupation', occupation);
    formData.append('location', location);
    if (apiKeyInput.value.trim()) {
      formData.append('apiKey', apiKeyInput.value.trim());
    }

    // Update UI for loading
    submitBtn.disabled = true;
    loadingIndicator.classList.remove('hidden');
    resultsSection.classList.add('hidden');
    
    // Telemetry updates
    debugResumeExtraction.textContent = file ? `PDF: ${file.name}` : `Pasted text (${text.length} chars)`;

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();

      if (res.ok && data.success) {
        currentResponseText = data.analysis;
        renderAnalysis(data.analysis);
        renderDebug(data.debug);
        
        resultsSection.classList.remove('hidden');
        showBanner('Resume analysis and skill gap evaluation completed successfully!', 'banner-success');
      } else {
        showBanner(`Analysis Failed: ${data.error || 'Server error occurred'}`, 'banner-error');
        if (data.debug) {
          renderDebug(data.debug);
        }
      }
    } catch (err) {
      showBanner(`Network or Processing Error: ${err.message}`, 'banner-error');
      debugStatus.textContent = 'Error';
      debugStatus.className = 'debug-val status-err';
    } finally {
      submitBtn.disabled = false;
      loadingIndicator.classList.add('hidden');
    }
  });

  // Render Analysis Output (Basic markdown formatting for readability)
  function renderAnalysis(text) {
    rawOutput.textContent = text;
    formattedOutput.innerHTML = formatMarkdown(text);
  }

  // Render Debug Information
  function renderDebug(debug) {
    if (!debug) return;
    
    if (debug.geminiStatus === 'Connected') {
      debugStatus.textContent = 'Connected (200 OK)';
      debugStatus.className = 'debug-val status-ok';
    } else if (debug.geminiStatus === 'Error') {
      debugStatus.textContent = 'API Error';
      debugStatus.className = 'debug-val status-err';
    }

    debugModel.textContent = debug.model || 'gemini-3.5-flash-lite';

    if (debug.resumeExtraction) {
      const rx = debug.resumeExtraction;
      debugResumeExtraction.textContent = rx.success 
        ? `Success (${rx.source === 'pdf_upload' ? `PDF: ${rx.filename}` : 'Text'}, ${rx.characterCount} chars)`
        : 'Failed';
    }
  }

  // View toggle: Formatted HTML vs Raw text
  toggleRawBtn.addEventListener('click', () => {
    if (rawOutput.classList.contains('hidden')) {
      rawOutput.classList.remove('hidden');
      formattedOutput.classList.add('hidden');
      toggleRawBtn.textContent = 'Show Formatted Text';
    } else {
      rawOutput.classList.add('hidden');
      formattedOutput.classList.remove('hidden');
      toggleRawBtn.textContent = 'Show Raw Text';
    }
  });

  // Copy results
  copyResultsBtn.addEventListener('click', () => {
    if (!currentResponseText) return;
    navigator.clipboard.writeText(currentResponseText).then(() => {
      const orig = copyResultsBtn.textContent;
      copyResultsBtn.textContent = 'Copied!';
      setTimeout(() => copyResultsBtn.textContent = orig, 1500);
    });
  });

  // Basic lightweight Markdown parser (headings, bold, bullet points, numbered lists, URLs)
  function formatMarkdown(text) {
    if (!text) return '';
    
    let escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    escaped = escaped.replace(/^### (.*$)/gim, '<h4>$1</h4>');
    escaped = escaped.replace(/^## (.*$)/gim, '<h3>$1</h3>');
    escaped = escaped.replace(/^# (.*$)/gim, '<h2>$1</h2>');

    escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/\*(.*?)\*/g, '<em>$1</em>');

    escaped = escaped.replace(/(https?:\/\/[^\s\)\],]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

    const lines = escaped.split('\n');
    let inList = false;
    let html = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('- ') || line.startsWith('* ')) {
        if (!inList) {
          html += '<ul>';
          inList = true;
        }
        html += `<li>${line.substring(2)}</li>`;
      } else {
        if (inList) {
          html += '</ul>';
          inList = false;
        }
        if (line.startsWith('<h2') || line.startsWith('<h3') || line.startsWith('<h4')) {
          html += line;
        } else if (line.length > 0) {
          html += `<p>${line}</p>`;
        }
      }
    }
    if (inList) html += '</ul>';

    return html;
  }
});
