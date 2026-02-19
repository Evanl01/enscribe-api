/**
 * Unit Test: SOAP Note Validator
 * 
 * Tests the detectAndNormalizeResponse and validateSoapAndBilling functions
 * to ensure they handle both LLM response formats correctly:
 * - Format 1: Direct data structure (expected)
 * - Format 2: Schema-wrapped response (LLM sometimes returns this)
 * 
 * No dependencies on API, database, or external services.
 */

import assert from 'assert';
import { UnitTestRunner } from './unitTestRunner.js';
import { detectAndNormalizeResponse, validateSoapAndBilling } from '../src/utils/soapNoteValidator.js';

const runner = new UnitTestRunner('SOAP Note Validator Unit Tests');

// Mock SOAP note and billing data
const VALID_SOAP_NOTE = {
  subjective: {
    "Chief complaint": "Headache for 2 days",
    "HPI": "Patient reports headache started yesterday",
    "History": "No prior history of migraine",
    "ROS": "Denies fever, chills, vision changes",
    "Medications": "Ibuprofen 400mg as needed",
    "Allergies": "NKDA"
  },
  objective: {
    "HEENT": "Pupils equal, round, reactive to light",
    "General": "Alert and oriented, no distress",
    "Cardiovascular": "Regular rate and rhythm",
    "Musculoskeletal": "No neck stiffness",
    "Other": "Normal neurologic exam"
  },
  assessment: "Tension headache",
  plan: "Continue ibuprofen, hydration, follow up in 1 week"
};

const VALID_BILLING = {
  icd10_codes: ["R51.9"],
  billing_code: "99213",
  additional_inquiries: "None at this time"
};

// ============================================
// FORMAT 1 TESTS: Direct Data Structure
// ============================================

runner.test('Detect direct data structure', () => {
  const format1Response = {
    soap_note: VALID_SOAP_NOTE,
    billing: VALID_BILLING
  };

  const result = detectAndNormalizeResponse(format1Response);
  
  assert.strictEqual(result.format, 'data');
  assert.deepStrictEqual(result.data, format1Response);
  assert.strictEqual(result.warning, undefined);
}, { 
  category: 'Format 1: Direct Data Structure',
  output: { 
    input: 'Direct data structure', 
    result: { format: 'data', warning: null } 
  }
});

runner.test('Validate valid SOAP and billing data', () => {
  const format1Response = {
    soap_note: VALID_SOAP_NOTE,
    billing: VALID_BILLING
  };
  
  validateSoapAndBilling(format1Response);
}, { category: 'Format 1: Direct Data Structure' });

runner.test('Reject missing billing', () => {
  const missingBilling = {
    soap_note: VALID_SOAP_NOTE,
  };
  
  assert.throws(
    () => validateSoapAndBilling(missingBilling),
    (err) => err.message.includes('billing'),
    'Should throw error about missing billing'
  );
}, { category: 'Format 1: Direct Data Structure' });

runner.test('Validate real SOAP note from API (pediatric case)', () => {
  const realSoapNote = {
    type: "soap_and_billing",
    soap_note: {
      subjective: {
        "Chief complaint": "Follow-up visit for chronic constipation in a 5-year-old girl.",
        "HPI": "Patient previously evaluated on February 4th for chronic constipation with stooling every 4-5 days and large stool burden confirmed by X-ray. Initial management included enemas and magnesium citrate given by father. At last visit, a clean-out regimen was prescribed: 4 capfuls Miralax in 4 cups sugar-free Gatorade, followed by maintenance mineral oil 1 tbsp, toilet training, hydration. Parents report clean-out produced \"massive amounts of diarrhea\" beginning Saturday and continuing through Monday/Tuesday. Difficulty getting child to ingest full volume Friday night; considering increasing volume to shorten duration of diarrhea. No fecal soiling reported. New concern: progressive erythematous rash on chest, back, arms, and now face over past 3 weeks, non-pruritic, unresponsive to diphenhydramine. Parent worried about possible food-related or medication-related reaction. No known environmental changes.\nRecent labs reviewed: serum IgA 42 mg/dL (slightly low), other labs (calcium, thyroid) normal. TTG-IgG 8 U (reference 0-5), raising concern for possible celiac disease despite normal TTG-IgA and deamidated antigliadin IgG. Plan discussed for further testing (HLA DQ2/DQ8) and possible endoscopy if indicated.",
        "History": "Past medical: Chronic functional constipation. No prior surgeries mentioned.\nFamily history: No known celiac disease or immunodeficiency reported.\nSocial history: Not discussed beyond toilet training challenges.\nDevelopment: Age-appropriate.",
        "ROS": "Positive for constipation and diarrhea during clean-out. Negative for abdominal pain, vomiting, fever. Skin: progressive erythematous rash, non-itchy. No other systemic symptoms elicited.",
        "Medications": "Miralax (polyethylene glycol) clean-out regimen; mineral oil maintenance. Occasional diphenhydramine given for rash.",
        "Allergies": "Known apple allergy; no medication allergies reported."
      },
      objective: {
        "HEENT": "Normocephalic, atraumatic; pupils equal and round; nasal mucosa pink; oropharynx clear, moist; no tonsillar enlargement.",
        "General": "Alert, interactive, age-appropriate, no acute distress; growth parameters documented on chart.",
        "Cardiovascular": "Regular rate and rhythm; no murmurs, rubs, gallops; peripheral pulses palpable.",
        "Musculoskeletal": "Full range of motion; normal gait; no deformities or swelling.",
        "Other": "Respiratory clear bilaterally; abdomen soft, non-tender, non-distended with bowel sounds; skin warm, dry with noted facial/chest erythema; neurologic exam normal."
      },
      assessment: "1. Chronic functional constipation - ongoing clean-out and maintenance regimen with need for optimization of Miralax volume and adherence.\n2. Selective IgA deficiency - mild (IgA 42 mg/dL).\n3. Possible celiac disease - mild elevation TTG-IgG with low IgA; requires further evaluation.\n4. Erythematous rash, non-pruritic, etiology unclear - consider food allergy or other dermatologic/allergic cause.",
      plan: "- Continue clean-out/maintenance regimen: Miralax clean-out on Fridays with possible increased volume to achieve complete evacuation within 6 hours; continue mineral oil 1 tbsp daily Mon-Wed; emphasize hydration and toilet sitting training.\n- Order celiac genetic testing (HLA DQ2/DQ8). If results indeterminate (anything other than negative/negative), discuss upper endoscopy with duodenal biopsy while on gluten diet.\n- Monitor bowel habits, frequency, stool consistency; parents to contact clinic if persistent accidents, abdominal pain, or concern for impaction. Consider rectal exam, ultrasound, or X-ray only if clinically indicated to avoid radiation.\n- Rash: Observe for progression, track food exposures; consider referral to Allergy/Immunology or Dermatology if persists or worsens.\n- Follow-up: routine GI follow-up in 4 months, sooner for concerns.\n- Provided education on positive reinforcement strategies for medication ingestion and toilet training."
    },
    billing: {
      icd10_codes: ["K59.00 Constipation, unspecified", "D80.2 Selective IgA immunodeficiency", "K90.0 Celiac disease (suspected)", "R21 Rash, nonspecific skin eruption"],
      billing_code: "99214 - Established patient visit with moderate complexity: review of prior records and labs, management of chronic constipation, discussion of abnormal serology and need for additional testing, coordination of care, and patient/caregiver counseling exceeding 25 minutes.",
      additional_inquiries: "- Detailed diet history including gluten intake, dairy, fruit (apple) exposure, artificial dyes/preservatives.\n- Frequency, volume, and consistency of stools during maintenance days.\n- Hydration status and daily fluid intake.\n- Complete list of over-the-counter products, supplements, and topical agents applied to skin.\n- Family history of autoimmune disorders, atopy, or GI diseases to refine risk assessment."
    }
  };

  // Test detection (should work with extra type field)
  const result = detectAndNormalizeResponse(realSoapNote);
  assert.strictEqual(result.format, 'data', 'Should detect real note as data format');

  // Test validation on the extracted data (ignoring the wrapper type field)
  validateSoapAndBilling(result.data);

  // Test that we can extract clean data (for storage without extra fields)
  const cleanData = {
    soap_note: result.data.soap_note,
    billing: result.data.billing,
  };
  assert(!('type' in cleanData), 'Cleaned data should not have type field');
  assert('soap_note' in cleanData && 'billing' in cleanData, 'Cleaned data should have required fields');
}, { 
  category: 'Format 1: Direct Data Structure',
  output: {
    format: 'data',
    inputHadTypeField: true,
    cleanedDataHasTypeField: false,
    cleanedDataHasRequiredFields: true
  }
});

// ============================================
// FORMAT 2 TESTS: Schema-Wrapped Response
// ============================================

runner.test('Detect schema-wrapped response', () => {
  const format2Response = {
    type: 'object',
    properties: {
      soap_note: {
        type: 'object',
        properties: VALID_SOAP_NOTE
      },
      billing: {
        type: 'object',
        properties: VALID_BILLING
      }
    }
  };

  const result = detectAndNormalizeResponse(format2Response);
  
  assert.strictEqual(result.format, 'schema_wrapped');
  assert(result.warning.includes('schema-wrapped'), 'Should include warning');
}, { 
  category: 'Format 2: Schema-Wrapped Response',
  output: {
    format: 'schema_wrapped',
    detected: true,
    warning: 'LLM returned schema-wrapped response instead of data'
  }
});

runner.test('Detect simplified schema-wrapped response (no nested type)', () => {
  // Variation: schema properties without nested type/properties wrapper
  const simplifiedSchema = {
    type: 'object',
    properties: {
      soap_note: VALID_SOAP_NOTE,
      billing: VALID_BILLING
    }
  };

  const result = detectAndNormalizeResponse(simplifiedSchema);
  
  assert.strictEqual(result.format, 'schema_wrapped');
  assert(result.warning.includes('schema-wrapped'), 'Should include warning');
  validateSoapAndBilling(result.data);
}, { 
  category: 'Format 2: Schema-Wrapped Response',
  output: {
    format: 'schema_wrapped',
    variation: 'simplified (no nested type/properties)',
    detected: true
  }
});

runner.test('Detect real nausea case (simplified schema variation)', () => {
  // Real LLM output: simplified schema without nested type/properties
  const nauseaResponseSimplified = {
    type: "object",
    properties: {
      soap_note: {
        subjective: {
          "Chief complaint": "Recurrent nausea with urgent bowel movements, most often after eating",
          "HPI": "12-year-old female seen January the 7th for evaluation of nausea that began around Christmas. Nausea sometimes lasts up to 2 days; can occur independent of meals. Frequently must rush to the bathroom shortly after eating; loose stools reported. Intermittent dizziness noted.",
          "History": "Prior upper endoscopy on February 4th: grossly normal; biopsies: mild chronic inactive gastritis, H. pylori negative. Abdominal point-of-care ultrasound: normal gallbladder and abdominal organs.",
          "ROS": "Positive: nausea, post-prandial urgency/diarrhea, intermittent dizziness. Negative: hematemesis, melena, hematochezia, weight loss, severe abdominal pain",
          "Medications": "None listed",
          "Allergies": "None documented"
        },
        objective: {
          "HEENT": "Not specifically documented",
          "General": "Alert, cooperative adolescent female; appears well nourished/obese (BMI percentile 98.18). No acute distress.",
          "Cardiovascular": "Not specifically examined",
          "Musculoskeletal": "Not specifically examined",
          "Other": "Abdominal exam not specifically documented. Labs reviewed; endoscopy and ultrasound normal."
        },
        assessment: "Recurrent functional gastrointestinal symptoms (nausea, post-prandial urgency) with negative endoscopy and labs - likely functional dyspepsia/IBS. Mild chronic inactive gastritis on biopsy, H. pylori negative. Pediatric obesity (BMI >98th percentile).",
        plan: "Reassurance given regarding absence of serious organic disease. Lifestyle counseling: walk 10-15 min after meals, gradual weight reduction. Avoid sugary drinks; balanced diet. Monitor symptoms and return if pain worsens."
      },
      billing: {
        icd10_codes: ["R11.0 Nausea", "R19.7 Diarrhea, unspecified", "K58.9 Irritable bowel syndrome, unspecified", "E66.9 Obesity, unspecified"],
        billing_code: "99213 - Established patient outpatient visit with expanded problem-focused history/exam and low medical decision making",
        additional_inquiries: "Detailed dietary history; menstrual history; stool diary; screen for anxiety or stressors"
      }
    }
  };

  const result = detectAndNormalizeResponse(nauseaResponseSimplified);
  
  assert.strictEqual(result.format, 'schema_wrapped', 'Should detect simplified schema');
  validateSoapAndBilling(result.data);
}, { 
  category: 'Format 2: Schema-Wrapped Response',
  output: {
    format: 'schema_wrapped',
    variation: 'simplified schema (real nausea case)',
    icd10Count: 4,
    billingCodeDetected: true
  }
});

runner.test('Extract and validate schema-wrapped data', () => {
  const format2Response = {
    type: 'object',
    properties: {
      soap_note: {
        type: 'object',
        properties: VALID_SOAP_NOTE
      },
      billing: {
        type: 'object',
        properties: VALID_BILLING
      }
    }
  };

  const result = detectAndNormalizeResponse(format2Response);
  validateSoapAndBilling(result.data);
}, { 
  category: 'Format 2: Schema-Wrapped Response',
  output: {
    inputFormat: 'schema_wrapped (full with nested type/properties)',
    extractedFormat: 'data',
    validationStatus: 'passed',
    extractedKeys: ['soap_note', 'billing']
  }
});

runner.test('Detect real cholecystitis case (full schema variation)', () => {
  // Real LLM output: full schema with nested type/properties 
  const cholecystitisResponseFull = {
    type: "object",
    properties: {
      soap_note: {
        type: "object",
        properties: {
          subjective: {
            "Chief complaint": "Post-prandial epigastric pain",
            "HPI": "Christopher is a 19-year-old male seen in follow-up for persistent post-prandial epigastric pain. Bowel movements occur every 2 days with occasional blood. Reports a 14-pound weight loss. Denies vomiting or diarrhea.",
            "History": "Past Medical History: muscular dystrophy, dilated cardiomyopathy secondary to muscular dystrophy, chronic heart failure with reduced ejection fraction, pulmonary hypertension. Cardiac devices: implantable cardioverter-defibrillator (ICD) and Barostim implant.",
            "ROS": "Gastrointestinal - abdominal pain, occasional blood in stool. No vomiting or diarrhea reported.",
            "Medications": "Sucralfate, famotidine, Miralax",
            "Allergies": "None documented"
          },
          objective: {
            "HEENT": "Not specifically documented",
            "General": "Not specifically documented",
            "Cardiovascular": "Known dilated cardiomyopathy with ICD and Barostim implant (no new findings reported).",
            "Musculoskeletal": "Baseline muscular dystrophy.",
            "Other": "Laboratory studies: ESR, thyroid, CBC normal. Calprotectin 150 (mildly elevated). Amylase 198 (slightly high), lipase normal. Imaging: Abdominal ultrasound shows markedly thickened gallbladder wall with gallstones consistent with calculus cholecystitis."
          },
          assessment: "Calculus cholecystitis with gallbladder wall thickening and gallstones causing post-prandial epigastric pain and mild transaminitis/hyperbilirubinemia. Complex comorbidities include muscular dystrophy with dilated cardiomyopathy and chronic systolic heart failure.",
          plan: "Refer to pediatric/general surgery for evaluation and management of calculus cholecystitis (possible cholecystectomy). Continue current gastrointestinal regimen. Monitor liver function. Follow-up after surgical consultation."
        }
      },
      billing: {
        type: "object",
        properties: {
          icd10_codes: ["K80.10 - Calculus of gallbladder with chronic cholecystitis without obstruction", "R10.13 - Epigastric pain", "G71.0 - Muscular dystrophy", "I50.2 - Systolic (congestive) heart failure"],
          billing_code: "99214 - Established patient visit with detailed history, detailed exam, and moderate medical decision-making complexity",
          additional_inquiries: "Clarify severity/frequency of pain; review medication list; obtain allergy history; assess social support; evaluate cardiac status for pre-operative risk."
        }
      }
    }
  };

  const result = detectAndNormalizeResponse(cholecystitisResponseFull);
  
  assert.strictEqual(result.format, 'schema_wrapped', 'Should detect full schema');
  validateSoapAndBilling(result.data);
}, { 
  category: 'Format 2: Schema-Wrapped Response',
  output: {
    format: 'schema_wrapped',
    variation: 'full schema (nested type/properties - real cholecystitis case)',
    icd10Count: 4,
    comorbidities: 'muscular dystrophy, cardiomyopathy, heart failure'
  }
});

runner.test('Reject schema with missing billing', () => {
  const format2WithoutBilling = {
    type: 'object',
    properties: {
      soap_note: {
        type: 'object',
        properties: VALID_SOAP_NOTE
      }
    }
  };

  const result = detectAndNormalizeResponse(format2WithoutBilling);
  assert.strictEqual(result.format, 'unknown');
}, { category: 'Format 2: Schema-Wrapped Response' });

// ============================================
// EDGE CASES & ERROR HANDLING
// ============================================

runner.test('Detect unknown format gracefully', () => {
  const unknownFormat = {
    some_random_key: 'value',
    another_key: { nested: 'data' }
  };

  const result = detectAndNormalizeResponse(unknownFormat);
  assert.strictEqual(result.format, 'unknown');
}, { category: 'Edge Cases & Error Handling' });

runner.test('Reject null input', () => {
  assert.throws(
    () => validateSoapAndBilling(null),
    (err) => err.message.includes('not an object'),
    'Should reject null'
  );
}, { 
  category: 'Edge Cases & Error Handling',
  output: {
    input: null,
    expectedError: 'Response is not an object',
    received: 'Error thrown correctly'
  }
});

runner.test('Reject incomplete billing structure', () => {
  const incompleteBilling = {
    soap_note: VALID_SOAP_NOTE,
    billing: {
      icd10_codes: ["R51.9"],
    }
  };

  assert.throws(
    () => validateSoapAndBilling(incompleteBilling),
    (err) => err.message.includes('billing'),
    'Should reject incomplete billing'
  );
}, { category: 'Edge Cases & Error Handling' });

runner.test('Reject excessive ICD10 codes (max 10)', () => {
  const tooManyICD10 = {
    soap_note: VALID_SOAP_NOTE,
    billing: {
      icd10_codes: Array(11).fill('R51.9'),
      billing_code: "99213",
      additional_inquiries: "None"
    }
  };

  assert.throws(
    () => validateSoapAndBilling(tooManyICD10),
    (err) => err.message.includes('too many'),
    'Should reject more than 10 ICD10 codes'
  );
}, { category: 'Edge Cases & Error Handling' });

// ============================================
// RUN TESTS AND REPORT
// ============================================

runner.exit();
