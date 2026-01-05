/**
 * Test Setup Script
 * Creates test data for recordings API tests:
 * - 3 test encounters (900, 901, 902)
 * - 5 test recording files (3 attached to encounters, 2 unattached)
 * - Saves metadata to testData.json for use by other tests
 *
 * Run once before executing test suites:
 * npm run test:setup
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Load .env.local
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env.local');
dotenv.config({ path: envPath });

import { getTestAccount, hasTestAccounts } from './testConfig.js';
import { createClient } from '@supabase/supabase-js';

const RECORDINGS_BUCKET = 'audio-files';
const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');
const FIXTURES_README = path.resolve(__dirname, 'fixtures/README.txt');
const TEST_DATA_FILE = path.resolve(__dirname, 'testData.json');

/**
 * TEST DATA SCHEMA - Source of truth for what test data should look like
 * Defines expected files and their attachment status
 * Index 0-2: attached to encounters (900, 901, 902)
 * Index 3-4: unattached (no encounter)
 */
const TEST_DATA_SCHEMA = [
  { fileIndex: 0, shouldBeAttached: true, encounterId: 900 },   // Will be replaced with actual encounter ID
  { fileIndex: 1, shouldBeAttached: true, encounterId: 901 },
  { fileIndex: 2, shouldBeAttached: true, encounterId: 902 },
  { fileIndex: 3, shouldBeAttached: false, encounterId: null },
  { fileIndex: 4, shouldBeAttached: false, encounterId: null },
];

/**
 * Default dotPhrases if fixture file not readable
 */
const DEFAULT_DOTPHRASES = [
  { trigger: 'pt', expansion: 'patient' },
  { trigger: 'hx', expansion: 'history' },
];

/**
 * Create a recording entry in the database linked to an encounter
 * Uses API endpoint instead of direct database insert
 */
async function createRecordingEntry(accessToken, recordingPath, encounterId) {
  try {
    const response = await fetch('http://localhost:3001/api/recordings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        patientEncounter_id: encounterId,
        recording_file_path: recordingPath,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error(`    Error creating recording: ${error.error || response.statusText}`);
      return null;
    }

    const recordingData = await response.json();
    // Return the created recording object with its ID
    return recordingData.data || recordingData;
  } catch (error) {
    console.error(`    Error creating recording: ${error.message}`);
    return null;
  }
}

/**
 * Get fixture files - uses actual files in fixtures folder
 */
function getFixtureFiles() {
  try {
    const files = fs.readdirSync(FIXTURES_DIR);
    const audioFiles = files.filter(f => 
      /\.(mp3|mp4|wav|m4a|aac)$/i.test(f)
    );
    return audioFiles;
  } catch (error) {
    console.error(`Error reading fixtures directory: ${error.message}`);
    return [];
  }
}

/**
 * Parse dotPhrase fixtures from README.txt
 * Returns array of { trigger, expansion } objects
 */
function readDotPhraseFixtures() {
  try {
    const content = fs.readFileSync(FIXTURES_README, 'utf-8');
    const dotPhrases = [];
    const lines = content.split('\n');
    let inDotPhrasesSection = false;
    let currentPhrase = {};
    
    for (const line of lines) {
      // Start of dotPhrases section
      if (line.includes('DOTPHRASES TO ADD')) {
        inDotPhrasesSection = true;
        continue;
      }
      
      // End of section (HOW IT WORKS or next section)
      if (inDotPhrasesSection && (line.includes('HOW IT WORKS') || line.includes('CREATED DOTPHRASES'))) {
        inDotPhrasesSection = false;
      }
      
      // Parse dotPhrase lines
      if (inDotPhrasesSection) {
        const triggerMatch = line.match(/TRIGGER\s*=\s*(\S+)/);
        const expansionMatch = line.match(/EXPANSION\s*=\s*(.+)/);
        
        if (triggerMatch) {
          currentPhrase.trigger = triggerMatch[1].trim();
        }
        if (expansionMatch) {
          currentPhrase.expansion = expansionMatch[1].trim();
        }
        
        // If we have both, add to array and reset
        if (currentPhrase.trigger && currentPhrase.expansion) {
          dotPhrases.push(currentPhrase);
          currentPhrase = {};
        }
      }
    }
    
    return dotPhrases.length > 0 ? dotPhrases : DEFAULT_DOTPHRASES;
  } catch (error) {
    console.warn(`Could not read dotPhrase fixtures (${error.message}), using defaults`);
    return DEFAULT_DOTPHRASES;
  }
}

/**
 * Upload file to Supabase storage
 */
async function uploadToStorage(supabase, userId, localPath, filename) {
  try {
    const fileData = fs.readFileSync(localPath);
    const remotePath = `${userId}/${filename}`;
    
    const { data, error } = await supabase.storage
      .from(RECORDINGS_BUCKET)
      .upload(remotePath, fileData, { upsert: true });

    if (error) {
      console.error(`  ✗ Error uploading ${filename}:`, error.message);
      return null;
    }

    console.log(`  ✓ Uploaded: ${remotePath}`);
    return remotePath;
  } catch (error) {
    console.error(`  ✗ Error uploading ${filename}:`, error.message);
    return null;
  }
}

/**
 * Get all remote recordings from Supabase bucket using user's token
 */
async function getRemoteRecordingFiles(supabase, userId) {
  try {
    const { data, error } = await supabase.storage
      .from(RECORDINGS_BUCKET)
      .list(`${userId}`, { limit: 100 });

    if (error) throw error;
    return (data || []).map(file => ({
      name: file.name,
      path: `${userId}/${file.name}`,
    }));
  } catch (error) {
    console.error('  Error listing bucket files:', error.message);
    return [];
  }
}

/**
 * Get batch recordings for the user via API (JWT)
 */
async function getBatchRecordings(accessToken) {
  try {
    const response = await fetch('http://localhost:3001/api/recordings', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`  Error fetching recordings: ${response.status}`);
      return [];
    }

    return await response.json();
  } catch (error) {
    console.error('  Error querying recordings:', error.message);
    return [];
  }
}

/**
 * Main setup function with smart duplicate detection
 */
async function setupTestData() {
  console.log('\n' + '='.repeat(70));
  console.log('RECORDINGS API TEST SETUP');
  console.log('='.repeat(70) + '\n');

  // Check if server is running
  try {
    const response = await fetch('http://localhost:3001/health');
    if (!response.ok) throw new Error('Server not responding');
    console.log('✅ Server health check passed\n');
  } catch (error) {
    console.error('❌ Server is not running. Start the server with:');
    console.error('   npm run dev:fastify\n');
    process.exit(1);
  }

  // Get test account credentials
  if (!hasTestAccounts()) {
    console.error('❌ Test account not configured. Set TEST_ACCOUNT_EMAIL and TEST_ACCOUNT_PASSWORD in .env.local');
    process.exit(1);
  }

  const testAccount = getTestAccount('primary');
  if (!testAccount?.email || !testAccount?.password) {
    console.error('❌ Invalid test account credentials');
    process.exit(1);
  }

  console.log(`Using test account: ${testAccount.email}\n`);

  try {
    // Step 1: Sign in to get access token
    console.log('Step 1: Authenticating...');
    const signInResponse = await fetch('http://localhost:3001/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'sign-in',
        email: testAccount.email,
        password: testAccount.password,
      }),
    });

    if (!signInResponse.ok) {
      throw new Error('Failed to sign in. Check credentials in .env.local');
    }

    const authData = await signInResponse.json();
    const accessToken = authData.session.access_token;
    const userId = authData.user.id;
    console.log(`✓ Authenticated as: ${userId}\n`);

    // Step 2: Create Supabase client
    console.log('Step 2: Initializing Supabase client...');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      accessToken
    );
    console.log('✓ Supabase client ready\n');

    // Step 3: Check existing recordings
    console.log('Step 3: Checking for existing test data...');
    
    const localAudioFiles = getFixtureFiles();
    const remoteFiles = await getRemoteRecordingFiles(supabase, userId);
    const apiRecordings = await getBatchRecordings(accessToken);
    
    console.log(`  Local fixtures: ${localAudioFiles.length} files`);
    console.log(`  Remote storage: ${remoteFiles.length} files`);
    console.log(`  Database recordings: ${apiRecordings.length} recordings\n`);

    // Check for extra files in bucket (like .emptyFolderPlaceholder)
    const remoteFileNames = new Set(remoteFiles.map(f => f.name));
    const extraFiles = remoteFileNames.size > 0 ? 
      Array.from(remoteFileNames).filter(f => !localAudioFiles.includes(f)) : [];
    
    if (extraFiles.length > 0) {
      const redStart = '\x1b[31m';
      const redEnd = '\x1b[0m';
      console.log(redStart + '🚨 RED WARNING: Extra files found in storage (not in fixtures):');
      extraFiles.forEach(f => console.log(`   - ${f}`));
      console.log('   These may affect test ordering. Consider cleaning up.' + redEnd + '\n');
    }

    // Get all encounters for validation
    const allEncounters = await fetch('http://localhost:3001/api/patient-encounters', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }).then(r => r.json()).catch(() => []);
    
    const encounterMap = new Map(allEncounters.map(e => [e.id, e]));

    // Match bucket files to API recordings (DB entries)
    // Attached = Bucket files with DB entry AND patientEncounter_id set AND encounter exists
    // Unattached = Bucket files without DB entry
    
    const matchedAttached = [];
    const unmatchedUnattached = [];
    
    // Get bucket files excluding placeholder
    const bucketFilesExcludingPlaceholder = remoteFiles.filter(f => !extraFiles.includes(f.name));
    
    for (const bucketFile of bucketFilesExcludingPlaceholder) {
      // Match by recording_file_path (user-id/filename)
      const dbRecording = apiRecordings.find(r => r.recording_file_path === bucketFile.path);
      
      if (dbRecording && dbRecording.patientEncounter_id !== null) {
        // Check if encounter exists
        const encounterExists = encounterMap.has(dbRecording.patientEncounter_id);
        
        if (encounterExists) {
          // Bucket file with DB entry AND attached to valid encounter
          matchedAttached.push({
            id: dbRecording.id,
            filename: bucketFile.name,
            path: bucketFile.path,
            attached: true,
            encounterId: dbRecording.patientEncounter_id,
          });
        } else {
          // Encounter doesn't exist - red warning
          const redStart = '\x1b[31m';
          const redEnd = '\x1b[0m';
          console.log(redStart + `⚠️  WARNING: Recording "${bucketFile.name}" claims to be attached to encounter ${dbRecording.patientEncounter_id}, but encounter doesn't exist!` + redEnd);
          // Still treat as unattached
          unmatchedUnattached.push({
            id: dbRecording?.id || null,
            filename: bucketFile.name,
            path: bucketFile.path,
            attached: false,
            encounterId: null,
          });
        }
      } else {
        // Bucket file without DB entry OR DB entry but not attached
        unmatchedUnattached.push({
          id: dbRecording?.id || null,
          filename: bucketFile.name,
          path: bucketFile.path,
          attached: false,
          encounterId: dbRecording?.patientEncounter_id || null,
        });
      }
    }

    // Debug: show matching results
    console.log(`\n  Matched (attached): ${matchedAttached.length} recordings`);
    if (matchedAttached.length > 0) {
      matchedAttached.forEach(r => console.log(`    - ${r.filename}`));
    }
    console.log(`  Unmatched (unattached): ${unmatchedUnattached.length} files`);
    if (unmatchedUnattached.length > 0) {
      unmatchedUnattached.forEach(f => console.log(`    - ${f.filename}`));
    }
    console.log();

    // Check if setup already complete (3 attached + 2 unattached)
    if (matchedAttached.length >= 3 && unmatchedUnattached.length >= 2) {
      console.log('✓ Complete test data already exists. Skipping recording setup.\n');
      
      // Reconcile dotPhrases: check existing, delete mismatched, create missing
      console.log('⚙️ Reconciling test dotPhrases...');
      const expectedDotPhrases = readDotPhraseFixtures();
      const createdDotPhrases = [];
      
      // Fetch existing dotPhrases for the user
      let existingDotPhrases = [];
      try {
        const getResponse = await fetch('http://localhost:3001/api/dotphrases', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        });
        
        if (getResponse.ok) {
          const data = await getResponse.json();
          existingDotPhrases = Array.isArray(data) ? data : (data.data || []);
        }
      } catch (error) {
        console.warn(`  ⚠️  Error fetching existing dotPhrases: ${error.message}`);
      }
      
      // Build map of expected dotPhrases by trigger
      const expectedMap = new Map(expectedDotPhrases.map(dp => [dp.trigger, dp.expansion]));
      
      // Delete dotPhrases that don't match or aren't expected
      for (const existing of existingDotPhrases) {
        const expectedExpansion = expectedMap.get(existing.trigger);
        
        // If not in expected list or expansion doesn't match, delete it
        if (!expectedExpansion || expectedExpansion !== existing.expansion) {
          try {
            const deleteResponse = await fetch(`http://localhost:3001/api/dotphrases/${existing.id}`, {
              method: 'DELETE',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
              },
            });
            
            if (deleteResponse.ok) {
              console.log(`  🗑️  Deleted mismatched dotPhrase: "${existing.trigger}"`);
            }
          } catch (error) {
            console.warn(`  ⚠️  Error deleting dotPhrase "${existing.trigger}": ${error.message}`);
          }
        }
      }
      
      // Create or skip dotPhrases based on expected list
      for (const phrase of expectedDotPhrases) {
        const existing = existingDotPhrases.find(dp => dp.trigger === phrase.trigger);
        
        if (existing && existing.expansion === phrase.expansion) {
          // Already exists with correct expansion
          console.log(`  ⏭️  Skipping dotPhrase: "${phrase.trigger}" (already exists)`);
          createdDotPhrases.push({
            id: existing.id,
            trigger: phrase.trigger,
            expansion: phrase.expansion,
          });
        } else {
          // Create new or update
          try {
            const response = await fetch('http://localhost:3001/api/dotphrases', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                trigger: phrase.trigger,
                expansion: phrase.expansion,
              }),
            });
            
            if (response.ok) {
              const created = await response.json();
              const dotPhraseId = created.id || created.data?.id || created.data?.dotPhrase?.id;
              createdDotPhrases.push({
                id: dotPhraseId,
                trigger: phrase.trigger,
                expansion: phrase.expansion,
              });
              console.log(`  ✓ Created dotPhrase: "${phrase.trigger}" → "${phrase.expansion}"`);
            } else {
              console.warn(`  ⚠️  Failed to create dotPhrase "${phrase.trigger}": ${response.status}`);
            }
          } catch (error) {
            console.warn(`  ⚠️  Error creating dotPhrase "${phrase.trigger}": ${error.message}`);
          }
        }
      }
      console.log();
      
      // Get encounters for test data
      const encounters = [];
      const encResponse = await fetch('http://localhost:3001/api/patient-encounters', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (encResponse.ok) {
        const encData = await encResponse.json();
        for (let i = 0; i < Math.min(3, encData.length); i++) {
          encounters.push(encData[i]);
        }
      }

      // Build testData from existing records
      const recordings = [
        ...matchedAttached.slice(0, 3),
        ...unmatchedUnattached.slice(0, 2),
      ];

      // Load old testData to compare encounter IDs
      let oldRecordings = [];
      try {
        if (fs.existsSync(TEST_DATA_FILE)) {
          const oldTestData = JSON.parse(fs.readFileSync(TEST_DATA_FILE, 'utf-8'));
          oldRecordings = oldTestData.recordings || [];
        }
      } catch (e) {
        // Ignore if file doesn't exist or can't be parsed
      }

      // Update recordings with encounter IDs and print status
      const recordingsWithIds = recordings.map(r => {
        if (r.encounterId !== null) {
          const oldRec = oldRecordings.find(or => or.filename === r.filename);
          const oldEncounterId = oldRec?.encounterId;
          
          if (oldEncounterId === r.encounterId) {
            console.log(`  ✓ Recording "${r.filename}": Encounter ${r.encounterId} (SAME AS BEFORE)`);
          } else {
            console.log(`  ✓ Recording "${r.filename}": Encounter ${r.encounterId} (UPDATED)`);
          }
        }
        return r;
      });

      const testData = {
        createdAt: new Date().toISOString(),
        testAccount: {
          email: testAccount.email,
          userId: userId,
        },
        encounters: encounters.map((e, i) => ({
          id: e.id,
          name: e.name,
          displayId: 900 + i,
        })),
        recordings: recordingsWithIds,
        dotPhrases: createdDotPhrases,
      };

      fs.writeFileSync(TEST_DATA_FILE, JSON.stringify(testData, null, 2));
      console.log('✓ testData.json updated with dotPhrases\n');

      console.log('='.repeat(70));
      console.log('EXISTING TEST DATA');
      console.log('='.repeat(70));
      console.table(recordings.map(r => ({
        filename: r.filename,
        attached: r.attached ? 'Yes' : 'No',
        encounterId: r.encounterId || 'N/A',
      })));
      console.log();
      return;
    }

    // Step 4: Determine which files to upload and which encounters to create
    console.log('Step 4: Planning uploads and encounters...');
    
    // Determine files that need uploading
    const filesToUpload = localAudioFiles.filter(f => !remoteFileNames.has(f));
    const filesToUploadSchemaInfo = TEST_DATA_SCHEMA
      .filter(schema => filesToUpload.includes(localAudioFiles[schema.fileIndex]))
      .sort((a, b) => a.fileIndex - b.fileIndex);
    
    console.log(`✓ Files to upload: ${filesToUpload.length}`);
    console.log(`✓ Of those, attached to encounters: ${filesToUploadSchemaInfo.filter(s => s.shouldBeAttached).length}\n`);

    // Create only the encounters needed for newly uploaded attached files
    const encounters = [];
    const encountersNeeded = filesToUploadSchemaInfo.filter(s => s.shouldBeAttached).length;
    
    if (encountersNeeded > 0) {
      console.log(`Step 5: Creating ${encountersNeeded} test encounter(s)...`);
      for (let i = 0; i < encountersNeeded; i++) {
        const response = await fetch('http://localhost:3001/api/patient-encounters', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: `Encounter #${i + 1}`,
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to create encounter #${i + 1}`);
        }

        const encounter = await response.json();
        encounters.push(encounter);
        console.log(`✓ Created encounter #${i + 1}: ${encounter.id}`);
      }
      console.log();
    }

    // Step 6: Upload files to storage
    console.log(`Step ${encounters.length > 0 ? 6 : 5}: Uploading test files to storage...`);
    const uploadedPaths = [];
    const uploadMap = new Map(); // Map filename -> schema info for this file
    
    if (filesToUpload.length === 0) {
      console.log('  ⏭️  Skipping - all files already in storage');
    } else {
      for (const filename of filesToUpload) {
      const localPath = path.join(FIXTURES_DIR, filename);
      const remotePath = await uploadToStorage(supabase, userId, localPath, filename);
      if (remotePath) {
        uploadedPaths.push({
          filename,
          path: remotePath,
        });
        // Track which schema entry this file belongs to
        const schemaInfo = TEST_DATA_SCHEMA.find(s => localAudioFiles[s.fileIndex] === filename);
        if (schemaInfo) {
          uploadMap.set(filename, schemaInfo);
        }
      }
    }
    if (uploadedPaths.length > 0) {
      console.log();
    }
    }

    // Step 7: Create recording entries with correct attachment status
    console.log(`Step ${encounters.length > 0 ? 7 : 6}: Creating recording entries...`);
    const recordings = [];
    const newlyCreatedRecordings = [];
    
    // First add existing recordings to final list (already matched in Step 3)
    const existingRecordings = [
      ...matchedAttached.slice(0, 3),
      ...unmatchedUnattached,
    ];
    
    // Then add newly uploaded recordings
    if (uploadedPaths.length > 0) {
      let encounterIndex = 0;
      for (const uploaded of uploadedPaths) {
        const schemaInfo = uploadMap.get(uploaded.filename);
        
        if (schemaInfo && schemaInfo.shouldBeAttached && encounterIndex < encounters.length) {
          // Attach to newly created encounter
          const createdRecording = await createRecordingEntry(
            accessToken,
            uploaded.path,
            encounters[encounterIndex].id
          );
          
          if (createdRecording) {
            const recEntry = {
              id: createdRecording.id,
              filename: uploaded.filename,
              path: uploaded.path,
              attached: true,
              encounterId: encounters[encounterIndex].id,
            };
            recordings.push(recEntry);
            newlyCreatedRecordings.push(recEntry);
            console.log(`✓ Uploaded and attached to encounter ${encounters[encounterIndex].id}`);
            encounterIndex++;
          }
        } else {
          // Upload unattached
          const recEntry = {
            filename: uploaded.filename,
            path: uploaded.path,
            attached: false,
            encounterId: null,
          };
          recordings.push(recEntry);
          newlyCreatedRecordings.push(recEntry);
          console.log(`✓ Uploaded (unattached)`);
        }
      }
      console.log();
    } else {
      console.log('  ⏭️  Skipping - all recordings already in database');
    }

    // Combine existing and newly created recordings
    const allRecordings = [
      ...existingRecordings,
      ...recordings,
    ];

    // Step 8: Fix any mismatches between schema and actual state
    console.log(`\nStep ${encounters.length > 0 ? 8 : 7}: Checking for schema mismatches...`);
    let mismatchesFixed = 0;
    
    for (const bucketFile of bucketFilesExcludingPlaceholder) {
      const schemaInfo = TEST_DATA_SCHEMA.find(s => localAudioFiles[s.fileIndex] === bucketFile.name);
      const existingRec = allRecordings.find(r => r.filename === bucketFile.name);
      
      if (!schemaInfo || !existingRec) continue;
      
      const shouldBeAttached = schemaInfo.shouldBeAttached;
      const isAttached = existingRec.attached;
      
      // Case 1: Should be attached but isn't
      if (shouldBeAttached && !isAttached) {
        console.log(`  ⚠️  Fixing mismatch: "${bucketFile.name}" should be attached...`);
        
        // Create a new encounter for this file
        const response = await fetch('http://localhost:3001/api/patient-encounters', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: `Auto-created encounter for ${bucketFile.name.substring(0, 30)}...`,
          }),
        });
        
        if (response.ok) {
          const newEncounter = await response.json();
          
          // Attach the recording to the new encounter
          const attachResponse = await fetch('http://localhost:3001/api/recordings', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              patientEncounter_id: newEncounter.id,
              recording_file_path: bucketFile.path,
            }),
          });
          
          if (attachResponse.ok) {
            const createdRecording = await attachResponse.json();
            console.log(`    DEBUG: API response structure:`, JSON.stringify(createdRecording).substring(0, 200));
            
            // Extract ID from various possible response formats
            const recordingId = createdRecording.id || createdRecording.data?.id || createdRecording?.data;
            console.log(`    DEBUG: Extracted id=${recordingId}`);
            
            existingRec.attached = true;
            existingRec.encounterId = newEncounter.id;
            existingRec.id = recordingId;
            
            newlyCreatedRecordings.push(existingRec);
            console.log(`    ✓ Attached to encounter ${newEncounter.id}`);
            mismatchesFixed++;
          }
        }
      }
      
      // Case 2: Should be unattached but is attached
      if (!shouldBeAttached && isAttached) {
        const redStart = '\x1b[31m';
        const redEnd = '\x1b[0m';
        console.log(redStart + `  ⚠️  Cannot fix: "${bucketFile.name}" is attached but should be unattached` + redEnd);
        console.log(redStart + `    (Manual intervention required - cannot detach via API)` + redEnd);
      }
    }
    
    if (mismatchesFixed > 0) {
      console.log(`  ✓ Fixed ${mismatchesFixed} mismatch(es)\n`);
    } else {
      console.log('  ✓ No mismatches found\n');
    }

    // Step 9: Save test data to JSON file
    console.log(`Step ${encounters.length > 0 ? 9 : 8}: Saving test data...`);
    
    // Load old testData to compare encounter IDs for new recordings
    let oldRecordings = [];
    try {
      if (fs.existsSync(TEST_DATA_FILE)) {
        const oldTestData = JSON.parse(fs.readFileSync(TEST_DATA_FILE, 'utf-8'));
        oldRecordings = oldTestData.recordings || [];
      }
    } catch (e) {
      // Ignore if file doesn't exist or can't be parsed
    }
    
    // Print encounter ID assignment status for newly uploaded files
    for (const rec of recordings) {
      if (rec.attached) {
        const oldRec = oldRecordings.find(or => or.filename === rec.filename);
        if (oldRec?.encounterId === rec.encounterId) {
          console.log(`  ✓ Recording "${rec.filename}": Encounter ${rec.encounterId} (SAME AS BEFORE)`);
        } else {
          console.log(`  ✓ Recording "${rec.filename}": Encounter ${rec.encounterId} (ASSIGNED)`);
        }
      } else {
        console.log(`  ✓ Recording "${rec.filename}": Unattached`);
      }
    }

    // Step N: Create test dotPhrases
    console.log('Creating test dotPhrases...');
    const dotPhrasesToCreate = readDotPhraseFixtures();
    const createdDotPhrases = [];
    
    for (const phrase of dotPhrasesToCreate) {
      try {
        const response = await fetch('http://localhost:3001/api/dotphrases', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            trigger: phrase.trigger,
            expansion: phrase.expansion,
          }),
        });
        
        if (response.ok) {
          const created = await response.json();
          const dotPhraseId = created.id || created.data?.id || created.data?.dotPhrase?.id;
          createdDotPhrases.push({
            id: dotPhraseId,
            trigger: phrase.trigger,
            expansion: phrase.expansion,
          });
          console.log(`  ✓ Created dotPhrase: "${phrase.trigger}" → "${phrase.expansion}"`);
        } else {
          console.warn(`  ⚠️  Failed to create dotPhrase "${phrase.trigger}": ${response.status}`);
        }
      } catch (error) {
        console.warn(`  ⚠️  Error creating dotPhrase "${phrase.trigger}": ${error.message}`);
      }
    }
    console.log();

    const testData = {
      createdAt: new Date().toISOString(),
      testAccount: {
        email: testAccount.email,
        userId: userId,
      },
      encounters: encounters.map((e, i) => ({
        id: e.id,
        name: e.name,
        displayId: 900 + i,
      })),
      recordings: allRecordings,
      dotPhrases: createdDotPhrases,
    };

    fs.writeFileSync(TEST_DATA_FILE, JSON.stringify(testData, null, 2));
    console.log(`✓ Test data saved to testData.json\n`);
    
    // DEBUG: Print all recording IDs being saved
    console.log('DEBUG: Recordings in testData.json:');
    allRecordings.forEach((rec, idx) => {
      console.log(`  [${idx}] ${rec.filename}: id=${rec.id}, attached=${rec.attached}, encounterId=${rec.encounterId}`);
    });
    console.log();

    // Get encounter IDs actually used in test data (referenced by recordings)
    const usedEncounterIds = [...new Set(allRecordings
      .filter(r => r.encounterId !== null)
      .map(r => r.encounterId)
    )];

    // Summary - show all expected files vs actual status
    console.log('='.repeat(70));
    console.log('SETUP COMPLETE');
    console.log('='.repeat(70));
    
    // Build summary table showing expected vs actual for all local files
    const summaryData = localAudioFiles.map((filename, index) => {
      const rec = allRecordings.find(r => r.filename === filename);
      const expectedStatus = TEST_DATA_SCHEMA[index]?.shouldBeAttached ? 'Attached' : 'Unattached';
      const actualStatus = rec?.attached ? 'Attached' : 'Unattached';
      const wasModified = newlyCreatedRecordings.some(nr => nr.filename === filename);
      
      return {
        filename: filename,
        expected: expectedStatus,
        actual: actualStatus,
        encounterId: rec?.encounterId || 'N/A',
        status: (expectedStatus === actualStatus) ? '✓' : '✗',
        modified: wasModified ? '✓' : '✗',
      };
    });
    
    console.table(summaryData);
    
    console.log(`\nTest data created:`);
    console.log(`  Encounters: ${usedEncounterIds.length} (IDs: ${usedEncounterIds.join(', ')})`);
    const attachedCount = allRecordings.filter(r => r.attached).length;
    const unattachedCount = allRecordings.filter(r => !r.attached).length;
    console.log(`  Recordings: ${allRecordings.length} (${attachedCount} attached, ${unattachedCount} unattached)`);
    console.log(`  Storage: ${RECORDINGS_BUCKET} bucket`);
    console.log(`  Config: ${TEST_DATA_FILE}`);
    console.log('\nYou can now run:');
    console.log('  npm run test:recordings    - Test the recordings API');
    console.log('  npm run test:transcripts   - Test the transcripts API (creates transcripts)');
    console.log('  npm test                   - Run all tests');
    console.log('  npm run test:teardown      - Clean up when done\n');

  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    process.exit(1);
  }
}

// Run setup
setupTestData().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
