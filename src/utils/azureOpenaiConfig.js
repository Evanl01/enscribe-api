/**
 * Azure OpenAI Configuration Helper
 * 
 * Provides utilities for building Azure OpenAI API requests
 * - Constructs endpoint URLs with proper deployment and API version
 * - Builds authentication headers
 */

/**
 * Build Azure OpenAI API configuration for a specific deployment
 * @param {string} deploymentName - Azure deployment name (e.g., 'o3')
 * @returns {object} Configuration object with endpoint, headers, and metadata
 */
function buildAzureOpenAIConfig(deploymentName) {
  const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const azureApiKey = process.env.AZURE_OPENAI_KEY;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview';

  if (!azureEndpoint) {
    throw new Error('Missing AZURE_OPENAI_ENDPOINT environment variable');
  }
  if (!azureApiKey) {
    throw new Error('Missing AZURE_OPENAI_KEY environment variable');
  }
  if (!deploymentName) {
    throw new Error('Deployment name is required');
  }

  // Build Azure OpenAI endpoint URL
  const url = `${azureEndpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;

  // Build headers for Azure authentication
  const headers = {
    'Content-Type': 'application/json',
    'api-key': azureApiKey,
  };

  return {
    url,
    headers,
    deploymentName,
    apiVersion,
  };
}

/**
 * Get Azure OpenAI config for configured deployment from environment
 * @returns {object} Configuration object
 */
export function getAzureOpenAIConfig() {
  const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT || 'o3';
  return buildAzureOpenAIConfig(deploymentName);
}
