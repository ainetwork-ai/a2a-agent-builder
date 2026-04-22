import { callLLM } from "./llmManager";
import { withoutLLMRouting } from "./requestContext";

/**
 * Logical Reasoning Engine
 *
 * This module implements a sophisticated reasoning system inspired by first-order logic (FOL).
 * It uses three core components:
 * 1. Memory: Stores and manages propositions across multiple reasoning paths
 * 2. Prompt: Generates new logical propositions based on existing knowledge
 * 3. Verifier: Validates logical consistency of new propositions
 */

// Types for reasoning system
export interface ReasoningPath {
  id: string;
  propositions: string[];
  confidence: number;
}

export interface ReasoningContext {
  sharedFacts: string[];
  paths: ReasoningPath[];
}

/**
 * Memory Class: Manages logical propositions and reasoning paths
 *
 * This class acts as the knowledge store and orchestrator for multiple
 * reasoning paths, allowing the agent to explore different lines of thought
 * while maintaining a shared base of verified facts.
 */
export class ThinkingMemory {
  private searchPaths: Map<string, ReasoningPath>;
  private sharedVerifiedFacts: Set<string>;
  private readonly maxPaths: number;

  constructor(initialProposition?: string, maxPaths: number = 3) {
    this.maxPaths = maxPaths;
    this.searchPaths = new Map();
    this.sharedVerifiedFacts = new Set();

    if (initialProposition) {
      this.searchPaths.set('path-1', {
        id: 'path-1',
        propositions: [initialProposition],
        confidence: 1.0
      });
      this.sharedVerifiedFacts.add(initialProposition);
    }
  }

  /**
   * Get current reasoning context including all paths and shared facts
   */
  getContext(): ReasoningContext {
    const paths: ReasoningPath[] = [];
    for (const path of this.searchPaths.values()) {
      paths.push({
        id: path.id,
        propositions: [...path.propositions],
        confidence: path.confidence
      });
    }

    return {
      sharedFacts: Array.from(this.sharedVerifiedFacts),
      paths
    };
  }

  /**
   * Add a new proposition to a specific reasoning path
   */
  addPropositionToPath(pathId: string, proposition: string): void {
    const path = this.searchPaths.get(pathId);
    if (path && !path.propositions.includes(proposition)) {
      path.propositions.push(proposition);
    }
  }

  /**
   * Add a verified fact to the shared knowledge base
   * This fact will be propagated to all reasoning paths
   */
  addVerifiedFact(fact: string, confidence: number = 1.0): void {
    console.log(`🧠 [ThinkingMemory] New verified fact: "${fact}" (confidence: ${confidence})`);
    this.sharedVerifiedFacts.add(fact);

    // Propagate to all paths
    for (const path of this.searchPaths.values()) {
      if (!path.propositions.includes(fact)) {
        path.propositions.push(fact);
      }
    }
  }

  /**
   * Create a new reasoning path (e.g., for exploring alternative hypotheses)
   */
  createNewPath(basePropositions: string[]): string {
    const pathId = `path-${this.searchPaths.size + 1}`;

    if (this.searchPaths.size >= this.maxPaths) {
      // Remove lowest confidence path
      let lowestConfidence = Infinity;
      let lowestPathId = '';

      for (const [id, path] of this.searchPaths) {
        if (path.confidence < lowestConfidence) {
          lowestConfidence = path.confidence;
          lowestPathId = id;
        }
      }

      if (lowestPathId) {
        this.searchPaths.delete(lowestPathId);
        console.log(`🗑️ [ThinkingMemory] Removed low confidence path: ${lowestPathId}`);
      }
    }

    this.searchPaths.set(pathId, {
      id: pathId,
      propositions: [...basePropositions],
      confidence: 0.5
    });

    console.log(`🌱 [ThinkingMemory] Created new reasoning path: ${pathId}`);
    return pathId;
  }

  /**
   * Export all verified facts as a single string
   */
  exportFacts(): string {
    return Array.from(this.sharedVerifiedFacts).join('\n');
  }

  /**
   * Import facts from a string (used for persistence)
   */
  static fromFacts(factsString: string): ThinkingMemory {
    const memory = new ThinkingMemory();
    if (factsString && factsString !== '(empty)') {
      const facts = factsString.split('\n').filter(f => f.trim());
      facts.forEach(fact => memory.addVerifiedFact(fact));
    }
    return memory;
  }
}

/**
 * Prompt Class: Creative reasoning engine
 *
 * Generates new propositions based on existing knowledge using LLM.
 * This class is responsible for creative thinking and hypothesis generation.
 */
export class ReasoningPrompt {
  constructor(
    private modelName: string,
    private domain?: string
  ) {}

  /**
   * Generate next logical propositions based on current memory context
   */
  async generateNextPropositions(
    memoryContext: ReasoningContext,
    intent: string,
    conversationContext?: string
  ): Promise<string[]> {
    console.log("💡 [ReasoningPrompt] Generating next logical propositions...");

    const domainContext = this.domain ? `\nDomain: ${this.domain}` : '';
    const conversationCtx = conversationContext ? `\n\nRecent conversation:\n${conversationContext}` : '';

    const prompt = `You are an advanced reasoning system. Given the current knowledge base and intent, generate 2-3 new logical propositions.

Intent: ${intent}${domainContext}

# Current verified facts:
${memoryContext.sharedFacts.length > 0 ? memoryContext.sharedFacts.join('\n') : '(No facts yet)'}

# Current reasoning paths:
${memoryContext.paths.map(p =>
  `## Path ${p.id} (confidence: ${p.confidence})\n${p.propositions.join('\n')}`
).join('\n\n')}${conversationCtx}

# Your task:
Generate 2-3 new propositions that:
1. Build upon existing knowledge
2. Are relevant to the intent "${intent}"
3. Use first-order logic style natural language
4. Are specific and actionable (not vague generalizations)
5. Could be examples, deeper insights, or logical consequences

Return ONLY a JSON array of strings, no other text:
["proposition 1", "proposition 2", "proposition 3"]`;

    try {
      // Use LLM for background reasoning tasks
      const text = await callLLM([
        { role: "system", content: "You are an advanced reasoning system that generates logical propositions." },
        { role: "user", content: prompt }
      ]);

      console.log('📝 [ReasoningPrompt] Raw response:', text.substring(0, 200));

      // Extract JSON array from response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const jsonString = jsonMatch[0];
        console.log('🔍 [ReasoningPrompt] Extracted JSON:', jsonString);

        try {
          // Clean up JSON string before parsing
          const cleanedJson = jsonString
            .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
            .replace(/\n/g, '\\n') // Escape newlines within strings
            .replace(/\r/g, '\\r'); // Escape carriage returns

          const propositions = JSON.parse(cleanedJson) as string[];
          console.log(`💡 Generated ${propositions.length} propositions`);
          return propositions;
        } catch (parseError) {
          console.error('❌ [ReasoningPrompt] JSON parse error:', parseError);
          console.error('Failed JSON string:', jsonString);

          // Fallback: try to extract propositions manually
          const fallbackMatch = jsonString.match(/"([^"]+)"/g);
          if (fallbackMatch) {
            const fallbackProps = fallbackMatch.map(s => s.replace(/^"|"$/g, ''));
            console.log(`🔧 [ReasoningPrompt] Fallback extracted ${fallbackProps.length} propositions`);
            return fallbackProps;
          }

          return [];
        }
      }

      console.warn("⚠️ [ReasoningPrompt] No valid JSON found in response");
      return [];
    } catch (error) {
      console.error("❌ [ReasoningPrompt] Error generating propositions:", error);
      return [];
    }
  }

  /**
   * Generate an initial proposition from a conversation or topic
   */
  async generateInitialProposition(
    intent: string,
    conversationContext: string
  ): Promise<string> {
    const prompt = `Based on this conversation about "${intent}", create ONE clear, foundational proposition that captures the core concept.

Conversation:
${conversationContext}

Return ONLY the proposition as a single sentence, nothing else.`;

    try {
      const text = await callLLM([
        { role: "system", content: "You are an advanced reasoning system." },
        { role: "user", content: prompt }
      ]);
      return text.trim();
    } catch (error) {
      console.error("❌ [ReasoningPrompt] Error generating initial proposition:", error);
      return `Core concept: ${intent}`;
    }
  }
}

/**
 * Verifier Class: Logical consistency checker
 *
 * Validates that new propositions are logically consistent with
 * existing knowledge and don't introduce contradictions.
 */
export class LogicalVerifier {
  constructor(
    private modelName: string
  ) {}

  /**
   * Verify if a proposition is logically consistent with existing facts
   */
  async verify(
    memoryContext: ReasoningContext,
    proposition: string
  ): Promise<{ valid: boolean; confidence: number; reason?: string }> {
    console.log(`🛡️ [LogicalVerifier] Verifying: "${proposition}"`);

    const prompt = `You are a strict logical consistency checker. Verify if the candidate proposition is logically consistent with established facts.

# Established facts:
${memoryContext.sharedFacts.length > 0 ? memoryContext.sharedFacts.join('\n') : '(No facts yet)'}

# Candidate proposition:
"${proposition}"

# Your task:
Determine if this proposition:
1. Is consistent with established facts (no contradictions)
2. Adds meaningful information (not redundant)
3. Is specific and verifiable (not too vague)

Respond in this EXACT format:
VERDICT: [VALID/INVALID/UNCERTAIN]
CONFIDENCE: [0.0-1.0]
REASON: [brief explanation]

Examples:
VERDICT: VALID
CONFIDENCE: 0.9
REASON: Logically follows from existing facts and adds new insight

VERDICT: INVALID
CONFIDENCE: 0.8
REASON: Contradicts established fact about X`;

    try {
      const text = await withoutLLMRouting(() => callLLM([
        { role: "system", content: "You are a strict logical consistency checker." },
        { role: "user", content: prompt }
      ]));

      // Parse verification result
      const verdictMatch = text.match(/VERDICT:\s*(VALID|INVALID|UNCERTAIN)/i);
      const confidenceMatch = text.match(/CONFIDENCE:\s*(0?\.\d+|1\.0|0|1)/);
      const reasonMatch = text.match(/REASON:\s*(.+?)$/s);

      const verdict = verdictMatch ? verdictMatch[1].toUpperCase() : 'UNCERTAIN';
      const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5;
      const reason = reasonMatch ? reasonMatch[1].trim() : 'Unable to determine';

      const valid = verdict === 'VALID' && confidence >= 0.7;

      console.log(`🛡️ [LogicalVerifier] Result: ${verdict} (confidence: ${confidence})`);

      return { valid, confidence, reason };
    } catch (error) {
      console.error("❌ [LogicalVerifier] Error during verification:", error);
      return { valid: false, confidence: 0, reason: 'Verification failed' };
    }
  }
}

/**
 * Main Reasoning Engine
 *
 * Orchestrates the Memory-Prompt-Verifier cycle to evolve agent thinking
 */
export class LogicalReasoningEngine {
  private memory: ThinkingMemory;
  private prompt: ReasoningPrompt;
  private verifier: LogicalVerifier;

  constructor(
    modelName: string,
    initialKnowledge?: string,
    domain?: string
  ) {
    this.memory = initialKnowledge
      ? ThinkingMemory.fromFacts(initialKnowledge)
      : new ThinkingMemory();
    this.prompt = new ReasoningPrompt(modelName, domain);
    this.verifier = new LogicalVerifier(modelName);
  }

  /**
   * Run one cycle of reasoning: generate propositions and verify them
   */
  async runCycle(
    intent: string,
    conversationContext?: string
  ): Promise<{ factsAdded: number; totalFacts: number }> {
    console.log(`\n🌀 [ReasoningEngine] Running cycle for intent: "${intent}"`);

    const context = this.memory.getContext();

    // If no facts exist yet, generate an initial proposition
    if (context.sharedFacts.length === 0 && conversationContext) {
      const initialProp = await this.prompt.generateInitialProposition(intent, conversationContext);
      this.memory.addVerifiedFact(initialProp);
      console.log(`🌱 [ReasoningEngine] Created initial proposition: "${initialProp}"`);
    }

    // Generate candidate propositions
    const candidates = await this.prompt.generateNextPropositions(
      context,
      intent,
      conversationContext
    );

    if (candidates.length === 0) {
      console.log("⚠️ [ReasoningEngine] No candidates generated");
      return { factsAdded: 0, totalFacts: context.sharedFacts.length };
    }

    let factsAdded = 0;

    // Verify and add valid propositions
    for (const candidate of candidates) {
      const verification = await this.verifier.verify(context, candidate);

      if (verification.valid) {
        this.memory.addVerifiedFact(candidate, verification.confidence);
        factsAdded++;
      } else {
        console.log(`❌ [ReasoningEngine] Rejected: "${candidate}" - ${verification.reason}`);
      }
    }

    const finalContext = this.memory.getContext();
    console.log(`✅ [ReasoningEngine] Cycle complete. Added ${factsAdded} facts. Total: ${finalContext.sharedFacts.length}`);

    return { factsAdded, totalFacts: finalContext.sharedFacts.length };
  }

  /**
   * Run multiple cycles of reasoning
   */
  async evolve(
    intent: string,
    cycles: number = 2,
    conversationContext?: string
  ): Promise<string> {
    console.log(`🚀 [ReasoningEngine] Starting evolution for "${intent}" (${cycles} cycles)`);

    for (let i = 0; i < cycles; i++) {
      const result = await this.runCycle(intent, conversationContext);
      if (result.factsAdded === 0) {
        console.log("⏹️ [ReasoningEngine] No new facts added, stopping early");
        break;
      }
    }

    return this.memory.exportFacts();
  }

  /**
   * Get current knowledge as a string
   */
  getKnowledge(): string {
    return this.memory.exportFacts();
  }

  /**
   * Get current reasoning context
   */
  getContext(): ReasoningContext {
    return this.memory.getContext();
  }
}
