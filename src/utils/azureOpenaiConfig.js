/**
 * Azure OpenAI Configuration Helper
 * 
 * Provides utilities for building Azure OpenAI API requests
 * - Constructs endpoint URLs with proper deployment and API version
 * - Builds authentication headers
 */

/**
 * Get Azure OpenAI API configuration for a specific deployment
 * @param {string} deploymentName - Azure deployment name (e.g., 'gpt-4o-chat-deployment')
 * @returns {object} Configuration object with endpoint, headers, and metadata
 */
export function getAzureOpenAIConfig(deploymentName) {
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
 * Get Azure OpenAI config for GPT-4o transcription
 * @returns {object} Configuration object
 */
export function getAzureOpenAIConfigGPT4O() {
  const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O || 'gpt-4o-chat-deployment';
  return getAzureOpenAIConfig(deploymentName);
}

/**
 * Get Azure OpenAI config for SOAP note generation (o3)
 * @returns {object} Configuration object
 */
export function getAzureOpenAIConfigSOAP() {
  // Prioritize o3 for better reasoning and SOAP generation
  const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_O3;
  
  return getAzureOpenAIConfig(deploymentName);
}
