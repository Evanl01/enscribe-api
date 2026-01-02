Test Recording Files Placeholder
=================================

This folder contains test audio files used by the recordings API test suite.

FILES TO ADD:
- Dr Tung 2025-07-17 3PM.mp4 (will be attached to encounter 900)
- loohsienrong@gmail.com-1759170629598-26.mp4 (will be attached to encounter 901)
- loohsienrong@gmail.com-1759170779621-21.mp4 (will be attached to encounter 902)
- loohsienrong@gmail.com-1759263672656-16.mp4 (will be unattached)
- loohsienrong@gmail.com-1759263800995-09.mp3 (will be unattached)

HOW IT WORKS:
1. Add your test audio files to this folder (any format, dummy files are fine)
2. Run: npm run test:setup
3. The setup script will:
   - Read these files
   - Upload them to Supabase storage
   - Create test encounters and recordings
   - Save metadata to tests/testData.json (which will show actual online paths)
4. Run tests normally: npm run test:recordings
5. When done: npm run test:teardown (to clean up)

NOTES:
- Dummy audio files (even 1KB text files with .mp3 extension) work fine for testing
- The actual uploaded file paths will be different from local filenames
- All metadata is stored in testData.json after setup completes

UPLOADED FILE PATHS (Auto-populated after setup):
- Dr Tung 2025-07-17 3PM.mp4 → [Check testData.json after setup]
- loohsienrong@gmail.com-1759170629598-26.mp4 → [Check testData.json after setup]
- loohsienrong@gmail.com-1759170779621-21.mp4 → [Check testData.json after setup]
- loohsienrong@gmail.com-1759263672656-16.mp4 → [Check testData.json after setup]
- loohsienrong@gmail.com-1759263800995-09.mp3 → [Check testData.json after setup]

For actual paths, see: ../testData.json (created after npm run test:setup)
