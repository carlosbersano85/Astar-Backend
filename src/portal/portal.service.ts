import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class PortalService {
  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
  ) {}

  async getProfile(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) return null;
    if (user.role !== 'client') throw new ForbiddenException('Portal is for clients only');
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      subscriptionStatus: user.subscriptionStatus,
      birthDate: user.birthDate,
      birthPlace: user.birthPlace,
      birthTime: user.birthTime,
      createdAt: user.createdAt.toISOString(),
    };
  }

  async getMyOrders(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') throw new ForbiddenException('Portal is for clients only');
    const orders = await this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return orders.map((o) => ({
      id: o.id,
      type: o.type,
      amount: o.amount,
      method: o.method,
      createdAt: o.createdAt.toISOString(),
    }));
  }

  async getReports(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') throw new ForbiddenException('Portal is for clients only');
    const reports = await this.prisma.report.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return reports.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      content: r.content,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async getReportByType(userId: string, type: string) {
    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') throw new ForbiddenException('Portal is for clients only');
    const report = await this.prisma.report.findFirst({
      where: { userId, type },
      orderBy: { createdAt: 'desc' },
    });
    return report
      ? {
          id: report.id,
          type: report.type,
          title: report.title,
          content: report.content,
          createdAt: report.createdAt.toISOString(),
        }
      : null;
  }

  async getMessages(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') throw new ForbiddenException('Portal is for clients only');
    const messages = await this.prisma.message.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const answerMessagesWithoutQuestion = messages.filter((m) => m.type === 'answer' && !m.questionText);
    let questionTextByContent: Map<string, string> = new Map();
    if (answerMessagesWithoutQuestion.length > 0) {
      const answers = answerMessagesWithoutQuestion.map((m) => m.content);
      const questions = await this.prisma.question.findMany({
        where: { userId, answer: { in: answers } },
        select: { question: true, answer: true },
      });
      questions.forEach((q) => {
        if (q.answer) questionTextByContent.set(q.answer, q.question);
      });
    }

    return messages.map((m) => {
      let questionText = m.questionText ?? null;
      if (m.type === 'answer' && !questionText && m.content) {
        questionText = questionTextByContent.get(m.content) ?? null;
      }
      return {
        id: m.id,
        type: m.type,
        content: m.content,
        questionText,
        monthLabel: m.monthLabel,
        createdAt: m.createdAt.toISOString(),
      };
    });
  }

  async getNotifications(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') throw new ForbiddenException('Portal is for clients only');
    const notifications = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return notifications.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      category: n.category,
      read: n.read,
      createdAt: n.createdAt.toISOString(),
    }));
  }

  async markNotificationRead(userId: string, notificationId: string) {
    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') throw new ForbiddenException('Portal is for clients only');
    const n = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!n) return null;
    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { read: true },
    });
    return { id: n.id, read: true };
  }

  async markAllNotificationsRead(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') throw new ForbiddenException('Portal is for clients only');
    await this.prisma.notification.updateMany({
      where: { userId },
      data: { read: true },
    });
    return { ok: true };
  }

  async getMyQuestions(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') throw new ForbiddenException('Portal is for clients only');
    const questions = await this.prisma.question.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return questions.map((q) => ({
      id: q.id,
      question: q.question,
      answer: q.answer ?? null,
      status: q.status,
      createdAt: q.createdAt.toISOString(),
    }));
  }

  async createQuestion(userId: string, questionText: string) {
    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') throw new ForbiddenException('Portal is for clients only');
    if (!questionText || questionText.length < 1) {
      throw new ForbiddenException('Question text is required');
    }
    const question = await this.prisma.question.create({
      data: {
        userId,
        question: questionText,
        status: 'new',
      },
    });
    return {
      id: question.id,
      question: question.question,
      status: question.status,
      createdAt: question.createdAt.toISOString(),
    };
  }

  async getSubscriptionStatus(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') throw new ForbiddenException('Portal is for clients only');

    const isActive = user.subscriptionStatus === 'active';

    return {
      isActive,
      status: user.subscriptionStatus,
      canAccessAstro: isActive,
      canUseAIChat: isActive,
    };
  }

  async getAccessStatus(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new ForbiddenException('User not found');

    const canAccess = user.subscriptionStatus === 'active';

    return {
      canAccessAstroData: canAccess,
      canUseAIChat: canAccess,
      canAccessPortalFeatures: canAccess,
      reason: canAccess ? 'granted' : 'subscription_required',
    };
  }
}
