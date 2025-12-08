import { NextResponse } from 'next/server';
import { llmManager } from '@/lib/llmManager';

export async function GET() {
  try {
    const modelName = llmManager.getModelName();
    const displayModelName = llmManager.getDisplayModelName();
    const modelProvider = llmManager.getModelProvider();

    return NextResponse.json({
      modelName,
      displayModelName,
      modelProvider,
    });
  } catch (error) {
    console.error('Error getting model config:', error);
    return NextResponse.json(
      { error: 'Failed to get model configuration' },
      { status: 500 }
    );
  }
}
