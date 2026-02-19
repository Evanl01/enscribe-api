/**
 * Serialize Zod error to consistent format matching other endpoints
 * Converts ZodError with issues array to: {name: 'ZodError', message: '[...]'}
 * 
 * @param {ZodError} zodError - The Zod error object with issues array
 * @returns {Object} Serialized error in format {name: 'ZodError', message: '...'}
 */
export function serializeZodError(zodError) {
  // If already in serialized format, return as-is
  if (zodError.name === 'ZodError' && zodError.message && !zodError.issues) {
    return zodError;
  }

  // Serialize the issues array to JSON for the message
  const issuesJson = zodError.issues 
    ? JSON.stringify(zodError.issues, null, 2)
    : '[]';

  return {
    name: 'ZodError',
    message: issuesJson,
  };
}
