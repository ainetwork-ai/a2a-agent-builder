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
  // Private authoring/transport body — stripped from the public AgentCard,
  // persisted separately under skill:{agentId}. Never exposed in .well-known.
  instructions?: string;
}

export interface IntentImage {
  url: string;      // GCS bucket public URL
  mimeType: string; // e.g. "image/png" — used for FilePart.file.mimeType
}

export interface Intent {
  name: string;
  description: string;
  prompt: string;
  images?: IntentImage[]; // optional; up to 3
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
  // When true, the runtime runs the skill-selection step and injects matched
  // skill instructions. Defaults (at deploy/edit time) to "on if any skill has
  // instructions".
  useSkills?: boolean;
}

export interface AgentBuilderForm {
  name: string;
  description: string;
  prompt: string;
  skills: Skill[];
  modelProvider: 'google' | 'openai' | 'anthropic';
  modelName: string;
  intents?: Intent[];
  useSkills?: boolean;
}
