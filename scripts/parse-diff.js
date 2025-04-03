const fs = require('fs');
const { parse } = require('comment-parser');
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

// Global object to store diff hunk info per file
const diffInfo = {};

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
      JSON.stringify({ changes: {}, hasDocumentationChange: false, commit: null }, null, 2)
    );
    return;
  }

  const diffLines = diff.split('\n');
  console.log(`Processing ${diffLines.length} lines of diff`);

  let currentFile = '';
  const changes = {};
  let hasDocumentationChange = false;

  // Collect modified JS files and diff hunks info
  const modifiedFiles = [];
  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i];
    // Detect file name from git diff header
    if (line.startsWith('diff --git')) {
      currentFile = line.split(' ')[2].replace('a/', '');
      if (currentFile.endsWith('.js')) {
        modifiedFiles.push(currentFile);
      }
    } else if (line.startsWith('@@') && currentFile) {
      // Example hunk header: @@ -1348,0 +1349,2 @@
      const match = line.match(/\+(\d+)(?:,(\d+))?/);
      if (match) {
        const start = parseInt(match[1], 10);
        const count = match[2] ? parseInt(match[2], 10) : 1;
        if (!diffInfo[currentFile]) {
          diffInfo[currentFile] = [];
        }
        diffInfo[currentFile].push({ start, count });
      }
    }
  }

  console.log(`Found ${modifiedFiles.length} modified JavaScript files`);

  // Process each modified file to detect JSDoc changes
  for (const file of modifiedFiles) {
    try {
      // Extract previous version of file using Git
      let oldContent = '';
      const oldFilePath = path.join(oldDir, path.basename(file));
      try {
        oldContent = execSync(`git show HEAD^:"${file}"`, { encoding: 'utf8' });
        fs.writeFileSync(oldFilePath, oldContent);
        console.log(`Extracted previous version of ${file}`);
      } catch (err) {
        console.log(`File ${file} is new, no previous version available`);
      }

      // Extract current version of file using Git
      let newContent = '';
      const newFilePath = path.join(newDir, path.basename(file));
      try {
        newContent = execSync(`git show HEAD:"${file}"`, { encoding: 'utf8' });
        fs.writeFileSync(newFilePath, newContent);
        console.log(`Extracted current version of ${file}`);
      } catch (err) {
        console.log(`Cannot extract current version of ${file}: ${err.message}`);
        continue;
      }

      // Parse JSDoc comments from both versions using comment-parser
      let oldDocs = [];
      let newDocs = [];
      try {
        if (fs.existsSync(oldFilePath)) {
          oldDocs = parse(fs.readFileSync(oldFilePath, 'utf8'));
          console.log(`Parsed ${oldDocs.length} JSDoc comments from old version of ${file}`);
        }
      } catch (err) {
        console.log(`Error parsing old version of ${file}: ${err.message}`);
      }
      try {
        if (fs.existsSync(newFilePath)) {
          newDocs = parse(fs.readFileSync(newFilePath, 'utf8'));
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
        for (const doc of docChanges) {
          const diffRange = getExactChangedLines(file);
          if (diffRange) {
            const context = getDocContext(doc);
            changes[file].push({
              lines: `${diffRange.start}-${diffRange.end}`,
              context: [{ start: context.start, end: context.end }]
            });
            console.log(`Detected change in ${file}: lines ${diffRange.start}-${diffRange.end}`);
          }
        }
      }
    } catch (err) {
      console.error(`Error processing file ${file}: ${err.message}`);
    }
  }

  // Retrieve the current commit hash
  let commitHash = null;
  try {
    commitHash = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    console.log(`Current commit: ${commitHash}`);
  } catch (err) {
    console.error('Error retrieving commit hash:', err.message);
  }

  // Clean up temporary directories
  try {
    fs.rmSync(oldDir, { recursive: true, force: true });
    fs.rmSync(newDir, { recursive: true, force: true });
  } catch (err) {
    console.log(`Error cleaning up temporary directories: ${err.message}`);
  }

  // Output final JSON with changes, documentation change flag, and commit hash
  const jsonOutput = { changes, hasDocumentationChange, commit: commitHash };
  console.log('Detected changes:', changes);
  console.log('Has documentation change:', hasDocumentationChange);
  console.log('Output commit hash:', commitHash);
  fs.writeFileSync('changed-lines.json', JSON.stringify(jsonOutput, null, 2));
});

/**
 * Compare two sets of JSDoc comments to find differences.
 * For simplicity, this compares the description and tags.
 * @param {Array} oldDocs - Array of comment objects from the old version.
 * @param {Array} newDocs - Array of comment objects from the new version.
 * @returns {Array} - Array of changed comment objects from the new version.
 */
function compareJSDocComments(oldDocs, newDocs) {
  const changedDocs = [];
  
  // Create a simple lookup from old docs using the first line of description as key
  const oldDocsMap = {};
  for (const doc of oldDocs) {
    if (doc.description) {
      oldDocsMap[doc.description.split('\n')[0].trim()] = doc;
    }
  }
  
  // Compare each new doc
  for (const newDoc of newDocs) {
    if (!newDoc.description) continue;
    const key = newDoc.description.split('\n')[0].trim();
    const oldDoc = oldDocsMap[key];
    
    // If new doc is not found or if the entire comment block changed, mark as changed
    if (!oldDoc || JSON.stringify(oldDoc) !== JSON.stringify(newDoc)) {
      changedDocs.push(newDoc);
    }
  }
  
  return changedDocs;
}

/**
 * Extract context information from a JSDoc comment.
 * @param {Object} doc - A JSDoc comment object.
 * @returns {Object} - Object with start and end context strings.
 */
function getDocContext(doc) {
  const maxWords = 5;
  let description = '';
  if (doc.description) {
    description += doc.description + ' ';
  }
  if (doc.tags && doc.tags.length > 0) {
    description += doc.tags.map(tag => tag.name + ': ' + tag.description).join(' ') + ' ';
  }
  const words = description.split(/\s+/).filter(word => word);
  if (words.length <= maxWords * 2) {
    return { start: description.trim(), end: '' };
  }
  const startWords = words.slice(0, maxWords).join(' ') + '...';
  const endWords = '...' + words.slice(-maxWords).join(' ');
  return { start: startWords, end: endWords };
}

/**
 * Get the exact changed lines for a given file using diff info.
 * @param {string} file - The file name.
 * @returns {Object|null} - Object with start and end line numbers or null.
 */
function getExactChangedLines(file) {
  if (diffInfo[file] && diffInfo[file].length > 0) {
    // Using the first hunk; you may combine multiple hunks if needed.
    const { start, count } = diffInfo[file][0];
    return { start, end: start + count - 1 };
  }
  return null;
}
