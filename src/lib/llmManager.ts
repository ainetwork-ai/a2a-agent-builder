import { OpenAI, AzureOpenAI } from 'openai';

interface LLMConfig {
  apiUrl?: string;
  modelName: string;
  useAzure: boolean;
}

class LLMManager {
  private static instance: LLMManager;
  private client: OpenAI | AzureOpenAI | null = null;
  private config: LLMConfig;

  private constructor() {
    const apiUrl = process.env.LLM_API_URL;
    const modelName = process.env.LLM_MODEL;

    // If LLM_API_URL and LLM_MODEL are not set, use Azure OpenAI
    const useAzure = !apiUrl || !modelName;

    if (useAzure) {
      console.log('Using Azure OpenAI');
    } else {
      console.log('Using custom LLM API');
    }

    this.config = {
      apiUrl,
      modelName: modelName || 'gpt-4o',
      useAzure,
    };

    // Disable TLS verification if specified (for self-signed certificates)
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
  }

  public static getInstance(): LLMManager {
    if (!LLMManager.instance) {
      LLMManager.instance = new LLMManager();
    }
    return LLMManager.instance;
  }

  private getClient(): OpenAI | AzureOpenAI {
    if (!this.client) {
      const { apiUrl, useAzure } = this.config;

      if (useAzure) {
        // Use Azure OpenAI
        const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
        const azureApiKey = process.env.AZURE_OPENAI_KEY;

        if (!azureEndpoint || !azureApiKey) {
          throw new Error(
            'Azure OpenAI credentials are not configured. Please set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_KEY environment variables.'
          );
        }

        this.client = new AzureOpenAI({
          endpoint: azureEndpoint,
          apiKey: azureApiKey,
          apiVersion: process.env.LLM_API_VERSION || '2024-10-21',
        });
      } else {
        // Use custom LLM API
        if (!apiUrl) {
          throw new Error(
            'LLM API credentials are not configured. Please set LLM_API_URL and LLM_MODEL environment variables.'
          );
        }

        // Extract base URL (remove /chat/completions if present)
        const baseURL = apiUrl.replace(/\/chat\/completions$/, '');

        // Use LLM_API_KEY from environment if available, otherwise use dummy key
        const apiKey = process.env.LLM_API_KEY || 'dummy-key';

        this.client = new OpenAI({
          baseURL,
          apiKey,
        });
      }
    }
    return this.client;
  }

  public async generateChatResponse(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    maxTokens: number = 16384
  ): Promise<string> {
    try {
      const client = this.getClient();

      // Azure OpenAI uses max_completion_tokens, others use max_tokens
      const tokenParam = this.config.useAzure
        ? { max_completion_tokens: maxTokens }
        : { max_tokens: maxTokens };

      const response = await client.chat.completions.create({
        messages,
        ...tokenParam,
        model: this.config.modelName,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No content in LLM response');
      }

      return content;
    } catch (error) {
      console.error('Error calling LLM:', error);
      throw error;
    }
  }

  public isConfigured(): boolean {
    if (this.config.useAzure) {
      return !!(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_KEY);
    }
    return !!(this.config.apiUrl && this.config.modelName);
  }

  public getModelName(): string {
    return this.config.modelName;
  }
}

// Export singleton instance
export const llmManager = LLMManager.getInstance();

// Export convenience function
export async function callLLM(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  maxTokens?: number
): Promise<string> {
  return llmManager.generateChatResponse(messages, maxTokens);
}
