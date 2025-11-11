// server.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const XLSX = require('xlsx');

const app = express();
app.use(cors());
app.use(express.json());

// Multer config: in-memory storage (no files written to disk), 10MB limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

let rawData = [];
let cleanedData = [];

function parseFile(file) {
  if (!file) throw new Error('No file uploaded.');
  let data;

  const originalName = (file.originalname || '').toLowerCase();
  const mimetype = (file.mimetype || '').toLowerCase();

  if (mimetype.includes('csv') || originalName.endsWith('.csv')) {
    const csv = file.buffer.toString('utf8');
    data = Papa.parse(csv, { header: true, skipEmptyLines: true }).data;
  } else if (
    mimetype.includes('excel') ||
    originalName.endsWith('.xlsx') ||
    originalName.endsWith('.xls') ||
    mimetype === 'application/octet-stream'
  ) {
    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    data = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  } else {
    throw new Error('Unsupported file type. Please upload a CSV or XLS/XLSX file.');
  }

  return Array.isArray(data) ? data : [];
}

// Upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    const file = req.file;
    const data = parseFile(file);

    if (!data.length || Object.keys(data[0]).length === 0) {
      return res.status(400).json({ error: 'File is empty or malformed.' });
    }

    rawData = JSON.parse(JSON.stringify(data));
    cleanedData = JSON.parse(JSON.stringify(data));

    res.json({
      preview: data.slice(0, 20),
      columns: Object.keys(data[0]),
      rowCount: data.length,
    });
  } catch (e) {
    console.error('Upload error:', e.message);
    res.status(500).json({ error: 'Could not parse file: ' + e.message });
  }
});

// Cleaning endpoint
app.post('/api/clean', (req, res) => {
  try {
    const {
      columns,
      removeDuplicates,
      fillMissing,
      toNumber,
      replaceCol,
      replaceFrom,
      replaceTo,
      duplicateCheckColumns,
    } = req.body;

    let base = cleanedData && cleanedData.length ? cleanedData : rawData;
    let df = JSON.parse(JSON.stringify(Array.isArray(base) ? base : []));

    // Column selection
    if (Array.isArray(columns) && columns.length && df.length) {
      df = df.map(row => {
        const newRow = {};
        columns.forEach(col => {
          newRow[col] = row[col];
        });
        return newRow;
      });
    }

    // Remove duplicates
    if (removeDuplicates && df.length) {
      const seen = new Set();
      df = df.filter(row => {
        // Create a normalized key for comparison
        let key;
        if (Array.isArray(duplicateCheckColumns) && duplicateCheckColumns.length) {
          // Use specified columns for duplicate checking
          const values = duplicateCheckColumns.map(col => {
            const val = row[col];
            // Normalize values for better comparison
            if (val === null || val === undefined) return '';
            if (typeof val === 'string') return val.trim().toLowerCase();
            return val;
          });
          key = JSON.stringify(values);
        } else {
          // Use all columns for duplicate checking
          const normalizedRow = {};
          Object.keys(row).forEach(col => {
            const val = row[col];
            if (val === null || val === undefined) {
              normalizedRow[col] = '';
            } else if (typeof val === 'string') {
              normalizedRow[col] = val.trim().toLowerCase();
            } else {
              normalizedRow[col] = val;
            }
          });
          key = JSON.stringify(normalizedRow);
        }
        
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    // Handle missing values
    if (fillMissing && df.length) {
      if (fillMissing === 'mean') {
        const numericCols = Object.keys(df[0]).filter(col =>
          df.some(row => !isNaN(parseFloat(row[col])) && row[col] !== '' && row[col] != null)
        );

        numericCols.forEach(col => {
          const nums = df.map(row => parseFloat(row[col])).filter(v => !isNaN(v));
          const mean = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
          df.forEach(row => {
            if (row[col] === '' || row[col] == null || row[col] === undefined) {
              row[col] = mean;
            }
          });
        });
      } else if (fillMissing === 'median') {
        const numericCols = Object.keys(df[0]).filter(col =>
          df.some(row => !isNaN(parseFloat(row[col])) && row[col] !== '' && row[col] != null)
        );

        numericCols.forEach(col => {
          const nums = df.map(row => parseFloat(row[col])).filter(v => !isNaN(v)).sort((a, b) => a - b);
          const median = nums.length ? 
            (nums.length % 2 === 0 ? 
              (nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2 : 
              nums[Math.floor(nums.length / 2)]) : 0;
          df.forEach(row => {
            if (row[col] === '' || row[col] == null || row[col] === undefined) {
              row[col] = median;
            }
          });
        });
      } else if (fillMissing === 'mode') {
        Object.keys(df[0]).forEach(col => {
          const values = df.map(row => row[col]).filter(v => v !== '' && v != null && v !== undefined);
          const frequency = {};
          values.forEach(val => {
            frequency[val] = (frequency[val] || 0) + 1;
          });
          const mode = Object.keys(frequency).reduce((a, b) => frequency[a] > frequency[b] ? a : b, '');
          
          df.forEach(row => {
            if (row[col] === '' || row[col] == null || row[col] === undefined) {
              row[col] = mode || '';
            }
          });
        });
      } else if (fillMissing === 'forward') {
        Object.keys(df[0]).forEach(col => {
          let lastValue = '';
          df.forEach(row => {
            if (row[col] === '' || row[col] == null || row[col] === undefined) {
              row[col] = lastValue;
            } else {
              lastValue = row[col];
            }
          });
        });
      } else if (fillMissing === 'drop') {
        df = df.filter(row => Object.values(row).every(v => v !== '' && v != null && v !== undefined));
      }
    }

    // Find & Replace
    if (replaceCol && replaceFrom !== undefined && replaceTo !== undefined && df.length) {
      const targetCols = replaceCol === 'All Columns' ? Object.keys(df[0]) : [replaceCol];
      df.forEach(row => {
        targetCols.forEach(col => {
          if (Object.prototype.hasOwnProperty.call(row, col)) {
            const currentValue = String(row[col]);
            const searchValue = String(replaceFrom);
            
            // Handle different replacement strategies
            if (currentValue === searchValue) {
              // Exact match
              row[col] = replaceTo;
            } else if (currentValue.includes(searchValue)) {
              // Partial match - replace all occurrences
              row[col] = currentValue.replace(new RegExp(searchValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replaceTo);
            }
          }
        });
      });
    }

    // Convert to numbers
    if (Array.isArray(toNumber) && toNumber.length && df.length) {
      toNumber.forEach(col => {
        df.forEach(row => {
          const num = parseFloat(row[col]);
          if (!isNaN(num)) row[col] = num;
        });
      });
    }

    cleanedData = df;

    const responseColumns = df.length
      ? Object.keys(df[0])
      : (Array.isArray(columns) && columns.length
        ? columns
        : (rawData && rawData.length ? Object.keys(rawData[0]) : []));

    res.json({
      preview: df.slice(0, 20),
      columns: responseColumns,
      rowCount: df.length,
    });
  } catch (e) {
    console.error('Cleaning error:', e.message);
    res.status(500).json({ error: 'Error during cleaning: ' + e.message });
  }
});

// Download endpoint
app.get('/api/download', (req, res) => {
  if (!cleanedData || !cleanedData.length) {
    return res.status(400).send('No cleaned data available.');
  }

  try {
    const csv = Papa.unparse(cleanedData);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="cleaned_data.csv"');
    res.send(csv);
  } catch (e) {
    console.error('Download error:', e.message);
    res.status(500).send('Could not prepare download: ' + e.message);
  }
});

// Start server
app.listen(3000, () => {
  console.log('ðŸš€ MINICLEANER backend running at http://localhost:3000');
});
