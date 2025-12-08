export interface AgentCard {
  name: string;
  description: string;
  protocolVersion: string;
  version: string;
  url: string;
  capabilities: Record<string, unknown>;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: Skill[];
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

export interface Intent {
  name: string;
  description: string;
  prompt: string;
}

export interface AgentConfig extends AgentCard {
  id: string;
  prompt: string;
  modelProvider: 'google' | 'openai' | 'anthropic';
  modelName: string;
  createdAt: Date;
  updatedAt: Date;
  deployed?: boolean;
  intents?: Intent[];
}

export interface AgentBuilderForm {
  name: string;
  description: string;
  prompt: string;
  skills: Skill[];
  modelProvider: 'google' | 'openai' | 'anthropic';
  modelName: string;
  intents?: Intent[];
}