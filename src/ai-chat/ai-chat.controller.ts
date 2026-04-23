import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireSubscriptionGuard } from '../guards/require-subscription.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AiChatService } from './ai-chat.service';

@Controller('ai-chat')
export class AiChatController {
  constructor(private aiChatService: AiChatService) {}

  @Post()
  async chat(@Body() body: { messages: Array<{ role: string; content: string }> }) {
    return this.aiChatService.chat(body.messages);
  }

  @Post('test')
  async testGroq() {
    return this.aiChatService.chat([
      { role: 'user', content: 'Hello! Is Groq working through the backend?' },
    ]);
  }

  @Post('astro-analysis')
  @UseGuards(JwtAuthGuard, RequireSubscriptionGuard)
  async chatWithAstroData(
    @CurrentUser() user: { id: string },
    @Body() body: { messages: Array<{ role: string; content: string }>; natalData?: Record<string, any> },
  ) {
    return this.aiChatService.chatWithNatalData(user.id, body.messages, body.natalData);
  }

  @Post('personalized')
  @UseGuards(JwtAuthGuard, RequireSubscriptionGuard)
  async chatPersonalized(
    @CurrentUser() user: { id: string },
    @Body() body: { messages: Array<{ role: string; content: string }> },
  ) {
    return this.aiChatService.chatWithNatalData(user.id, body.messages);
  }
}
