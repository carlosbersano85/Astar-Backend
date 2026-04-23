import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AiChatService {
  constructor(private prisma: PrismaService) {}

  async chat(messages: Array<{ role: string; content: string }>) {
    const groqApiKey = process.env.GROQ_API_KEY;
    const groqModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

    if (!groqApiKey) {
      throw new Error('GROQ_API_KEY not configured');
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: groqModel,
        messages,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Groq API error: ${error.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    return {
      message: data.choices[0]?.message?.content || '',
      model: data.model,
      usage: data.usage,
    };
  }

  async chatWithNatalData(
    userId: string,
    messages: Array<{ role: string; content: string }>,
    natalChartData?: Record<string, any>,
  ) {
    const groqApiKey = process.env.GROQ_API_KEY;
    const groqModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

    if (!groqApiKey) {
      throw new Error('GROQ_API_KEY not configured');
    }

    // Fetch user's natal data if not provided
    let userData = natalChartData;
    if (!userData) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          name: true,
          birthDate: true,
          birthPlace: true,
          birthTime: true,
        },
      });

      if (user) {
        userData = {
          name: user.name,
          birthDate: user.birthDate,
          birthPlace: user.birthPlace,
          birthTime: user.birthTime,
        };
      }
    }

    // Inject natal data context into system message
    const systemMessage = {
      role: 'system',
      content: `You are an expert astrologer AI assistant. ${
        userData
          ? `The user's birth information: Name: ${userData.name}, Birth Date: ${userData.birthDate}, Birth Place: ${userData.birthPlace}, Birth Time: ${userData.birthTime}.`
          : ''
      } Provide personalized astrological insights based on their natal chart. Be helpful, accurate, and compassionate in your responses.`,
    };

    const enhancedMessages = [systemMessage, ...messages];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: groqModel,
        messages: enhancedMessages,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Groq API error: ${error.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    return {
      message: data.choices[0]?.message?.content || '',
      model: data.model,
      usage: data.usage,
      context: userData ? 'natal_chart' : 'general',
    };
  }
}
