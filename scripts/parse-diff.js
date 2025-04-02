const fs = require('fs');
const jsdoc = require('jsdoc-api');
const path = require('path');
const { execSync } = require('child_process');

// Create temporary directories for old and new versions
const oldDir = path.join(__dirname, 'temp-old');
const newDir = path.join(__dirname, 'temp-new');

if (!fs.existsSync(oldDir)) {
  fs.mkdirSync(oldDir, { recursive: true });
}
if (!fs.existsSync(newDir)) {
  fs.mkdirSync(newDir, { recursive: true });
}

// Read the diff from stdin
let diff = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  diff += chunk;
});

process.stdin.on('end', async () => {
  if (!diff.trim()) {
    console.log('No diff content received.');
    fs.writeFileSync(
      'changed-lines.json',
      JSON.stringify({ changes: {}, hasDocumentationChange: false }, null, 2)
    );
    return;
  }

  const diffLines = diff.split('\n');
  console.log(`Processing ${diffLines.length} lines of diff`);

  let currentFile = '';
  const changes = {};
  let hasDocumentationChange = false;
  
  // Find all modified files
  const modifiedFiles = [];
  
  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i];
    
    // Detect file name
    if (line.startsWith('diff --git')) {
      currentFile = line.split(' ')[2].replace('a/', '');
      if (currentFile.endsWith('.js')) {
        modifiedFiles.push(currentFile);
      }
    }
  }

  console.log(`Found ${modifiedFiles.length} modified JavaScript files`);
  
  // Process each modified file to detect JSDoc changes
  for (const file of modifiedFiles) {
    try {
      // Extract the previous version of the file
      try {
        const oldContent = execSync(`git show HEAD^:"${file}"`, { encoding: 'utf8' });
        const oldFilePath = path.join(oldDir, path.basename(file));
        fs.writeFileSync(oldFilePath, oldContent);
        console.log(`Extracted previous version of ${file}`);
      } catch (err) {
        console.log(`File ${file} is new, no previous version available`);
      }
      
      // Extract the current version of the file
      try {
        const newContent = execSync(`git show HEAD:"${file}"`, { encoding: 'utf8' });
        const newFilePath = path.join(newDir, path.basename(file));
        fs.writeFileSync(newFilePath, newContent);
        console.log(`Extracted current version of ${file}`);
      } catch (err) {
        console.log(`Cannot extract current version of ${file}: ${err.message}`);
        continue;
      }
      
      // Parse JSDoc comments from both versions
      const oldFilePath = path.join(oldDir, path.basename(file));
      const newFilePath = path.join(newDir, path.basename(file));
      
      let oldDocs = [];
      let newDocs = [];
      
      try {
        if (fs.existsSync(oldFilePath)) {
          oldDocs = await jsdoc.explain({ files: oldFilePath });
          console.log(`Parsed ${oldDocs.length} JSDoc comments from old version of ${file}`);
        }
      } catch (err) {
        console.log(`Error parsing old version of ${file}: ${err.message}`);
      }
      
      try {
        if (fs.existsSync(newFilePath)) {
          newDocs = await jsdoc.explain({ files: newFilePath });
          console.log(`Parsed ${newDocs.length} JSDoc comments from new version of ${file}`);
        }
      } catch (err) {
        console.log(`Error parsing new version of ${file}: ${err.message}`);
      }
      
      // Compare JSDoc comments to find differences
      const docChanges = compareJSDocComments(oldDocs, newDocs);
      
      if (docChanges.length > 0) {
        hasDocumentationChange = true;
        changes[file] = [];
        
        // For each changed doc, get the line numbers
        for (const doc of docChanges) {
          // Extract line numbers from the new version
          const lineNumbers = getLineNumbersForDoc(newDocs, doc);
          if (lineNumbers) {
            // Get context for the documentation change
            const context = getDocContext(doc);
            changes[file].push({
              lines: `${lineNumbers.start}-${lineNumbers.end}`,
              context: [{ start: context.start, end: context.end }]
            });
            console.log(`Detected change in ${file}: lines ${lineNumbers.start}-${lineNumbers.end}`);
          }
        }
      }
    } catch (err) {
      console.error(`Error processing file ${file}: ${err.message}`);
    }
  }
  
  // Clean up temporary directories
  try {
    fs.rmSync(oldDir, { recursive: true, force: true });
    fs.rmSync(newDir, { recursive: true, force: true });
  } catch (err) {
    console.log(`Error cleaning up temporary directories: ${err.message}`);
  }
  
  const jsonOutput = { changes, hasDocumentationChange };
  console.log('Detected changes:', changes);
  console.log('Has documentation change:', hasDocumentationChange);
  fs.writeFileSync('changed-lines.json', JSON.stringify(jsonOutput, null, 2));
});

/**
 * Compare two sets of JSDoc comments to find differences
 * @param {Array} oldDocs - JSDoc comments from the old version
 * @param {Array} newDocs - JSDoc comments from the new version
 * @returns {Array} - Array of changed docs from the new version
 */
function compareJSDocComments(oldDocs, newDocs) {
  const changedDocs = [];
  
  // Map old docs by longname for quick lookup
  const oldDocsMap = {};
  for (const doc of oldDocs) {
    if (doc.longname) {
      oldDocsMap[doc.longname] = doc;
    }
  }
  
  // Check each new doc for changes or additions
  for (const newDoc of newDocs) {
    if (!newDoc.longname) continue;
    
    const oldDoc = oldDocsMap[newDoc.longname];
    
    // If doc is new or has changed description
    if (!oldDoc || oldDoc.description !== newDoc.description) {
      changedDocs.push(newDoc);
      continue;
    }
    
    // Check for changes in parameters
    if (hasParamChanges(oldDoc, newDoc)) {
      changedDocs.push(newDoc);
      continue;
    }
    
    // Check for changes in return description
    if (hasReturnChanges(oldDoc, newDoc)) {
      changedDocs.push(newDoc);
      continue;
    }
    
    // Check for changes in examples
    if (hasExampleChanges(oldDoc, newDoc)) {
      changedDocs.push(newDoc);
    }
  }
  
  return changedDocs;
}

/**
 * Check if parameter documentation has changed
 * @param {Object} oldDoc - Old JSDoc object
 * @param {Object} newDoc - New JSDoc object
 * @returns {boolean} - True if parameters have changed
 */
function hasParamChanges(oldDoc, newDoc) {
  const oldParams = oldDoc.params || [];
  const newParams = newDoc.params || [];
  
  if (oldParams.length !== newParams.length) {
    return true;
  }
  
  for (let i = 0; i < newParams.length; i++) {
    const oldParam = oldParams[i];
    const newParam = newParams[i];
    
    if (!oldParam || !newParam) continue;
    
    if (oldParam.description !== newParam.description) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if return documentation has changed
 * @param {Object} oldDoc - Old JSDoc object
 * @param {Object} newDoc - New JSDoc object
 * @returns {boolean} - True if return descriptions have changed
 */
function hasReturnChanges(oldDoc, newDoc) {
  const oldReturns = oldDoc.returns || [];
  const newReturns = newDoc.returns || [];
  
  if (oldReturns.length !== newReturns.length) {
    return true;
  }
  
  for (let i = 0; i < newReturns.length; i++) {
    const oldReturn = oldReturns[i];
    const newReturn = newReturns[i];
    
    if (!oldReturn || !newReturn) continue;
    
    if (oldReturn.description !== newReturn.description) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if examples have changed
 * @param {Object} oldDoc - Old JSDoc object
 * @param {Object} newDoc - New JSDoc object
 * @returns {boolean} - True if examples have changed
 */
function hasExampleChanges(oldDoc, newDoc) {
  const oldExamples = oldDoc.examples || [];
  const newExamples = newDoc.examples || [];
  
  if (oldExamples.length !== newExamples.length) {
    return true;
  }
  
  for (let i = 0; i < newExamples.length; i++) {
    if (oldExamples[i] !== newExamples[i]) {
      return true;
    }
  }
  
  return false;
}

/**
 * Extract line numbers for a specific JSDoc comment
 * @param {Array} docs - Parsed JSDoc comments
 * @param {Object} targetDoc - The specific doc to find line numbers for
 * @returns {Object|null} - Object with start and end line numbers
 */
function getLineNumbersForDoc(docs, targetDoc) {
  if (!targetDoc || !targetDoc.meta) {
    return null;
  }
  
  // JSDoc provides line numbers in the meta property
  const lineStart = targetDoc.meta.lineno || 0;
  const lineEnd = targetDoc.meta.lineno + (targetDoc.meta.linecount || 10); // Estimate if linecount not available
  
  return {
    start: lineStart,
    end: lineEnd
  };
}

/**
 * Extract context information from a JSDoc comment
 * @param {Object} doc - JSDoc comment object
 * @returns {Object} - Object with start and end context
 */
function getDocContext(doc) {
  const maxWords = 5;
  let description = '';
  
  // Combine various documentation parts
  if (doc.description) {
    description += doc.description + ' ';
  }
  
  if (doc.params && doc.params.length > 0) {
    description += doc.params.map(p => p.description || '').join(' ') + ' ';
  }
  
  if (doc.returns && doc.returns.length > 0) {
    description += doc.returns.map(r => r.description || '').join(' ') + ' ';
  }
  
  const words = description.split(/\s+/).filter(word => word);
  
  if (words.length <= maxWords * 2) {
    return { start: description.trim(), end: '' };
  }
  
  const startWords = words.slice(0, maxWords).join(' ') + '...';
  const endWords = '...' + words.slice(-maxWords).join(' ');
  
  return {
    start: startWords,
    end: endWords
  };
}