/**
 * SOAP Note and Billing Response Validator
 * 
 * Validates SOAP note and billing suggestion responses from LLMs.
 * Handles both standard data format and schema-wrapped responses.
 */

/**
 * Validate SOAP and billing response structure
 * 
 * @param {Object} obj - Response object to validate
 * @throws {Error} - If validation fails with descriptive message
 * @returns {boolean} - True if valid
 */
export function validateSoapAndBilling(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Response is not an object');
  if (!obj.soap_note || typeof obj.soap_note !== 'object') throw new Error('Missing soap_note object');
  if (!obj.billing || typeof obj.billing !== 'object') throw new Error('Missing billing object');

  const s = obj.soap_note;
  if (!s.subjective || typeof s.subjective !== 'object') throw new Error('Missing subjective object');
  if (!s.objective || typeof s.objective !== 'object') throw new Error('Missing objective object');
  if (typeof s.assessment !== 'string') throw new Error('assessment must be a string');
  if (typeof s.plan !== 'string') throw new Error('plan must be a string');

  // Check subjective required keys
  const subjReq = ["Chief complaint", "HPI", "History", "ROS", "Medications", "Allergies"];
  for (const k of subjReq) {
    if (!(k in s.subjective)) throw new Error(`subjective missing required key: ${k}`);
    if (typeof s.subjective[k] !== 'string') throw new Error(`subjective.${k} must be a string`);
  }

  // Objective required keys
  const objReq = ["HEENT", "General", "Cardiovascular", "Musculoskeletal", "Other"];
  for (const k of objReq) {
    if (!(k in s.objective)) throw new Error(`objective missing required key: ${k}`);
    if (typeof s.objective[k] !== 'string') throw new Error(`objective.${k} must be a string`);
  }

  // Billing checks
  const b = obj.billing;
  if (!Array.isArray(b.icd10_codes)) throw new Error('billing.icd10_codes must be an array');
  if (typeof b.billing_code !== 'string') throw new Error('billing.billing_code must be a string');
  if (typeof b.additional_inquiries !== 'string') throw new Error('billing.additional_inquiries must be a string');

  // Limit check
  if (b.icd10_codes.length > 10) throw new Error('billing.icd10_codes has too many entries');

  return true;
}

/**
 * Detect response format (data vs schema-wrapped) and normalize
 * 
 * Handles two formats:
 * - Format 1: Direct data structure (expected)
 * - Format 2: Schema-wrapped response (LLM returning schema definition)
 * 
 * @param {Object} obj - Parsed JSON response from LLM
 * @returns {Object} - { format, data, warning? }
 *   - format: 'data' | 'schema_wrapped' | 'unknown'
 *   - data: normalized data object
 *   - warning: optional warning message if format was adjusted
 */
export function detectAndNormalizeResponse(obj) {
  // Format 1: Direct data (expected)
  if (obj.soap_note && typeof obj.soap_note === 'object' && 
      !obj.soap_note.type && obj.billing && !obj.billing.type) {
    return { format: 'data', data: obj };
  }
  
  // Format 2: Schema wrapper (LLM sometimes returns this)
  if (obj.type === 'object' && obj.properties) {
    const soapNoteSchema = obj.properties.soap_note;
    const billingSchema = obj.properties.billing;
    
    if (soapNoteSchema && billingSchema) {
      return { 
        format: 'schema_wrapped',
        data: { 
          soap_note: soapNoteSchema.properties || soapNoteSchema,
          billing: billingSchema.properties || billingSchema
        },
        warning: 'LLM returned schema-wrapped response instead of data'
      };
    }
  }
  
  // Format 3: Unrecognized
  return { format: 'unknown', data: obj };
}
