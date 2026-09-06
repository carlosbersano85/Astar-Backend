import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { UserResponse } from '../users/user.interface';
import { RegisterDto } from './dto/register.dto';

export interface AuthResult {
  user: UserResponse;
  access_token: string;
}

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const birthTimeKnown = dto.birthTimeKnown ?? Boolean(dto.birthTime);
    const user = await this.usersService.create({
      email: dto.email,
      name: dto.name,
      password: dto.password,
      role: 'client',
      isActive: true,
      subscriptionStatus: 'inactive',
      birthDate: dto.birthDate,
      birthPlace: dto.birthPlace,
      birthTime: birthTimeKnown ? dto.birthTime : undefined,
      birthLatitude:
        dto.birthLatitude === undefined ? undefined : Number(dto.birthLatitude),
      birthLongitude:
        dto.birthLongitude === undefined ? undefined : Number(dto.birthLongitude),
      birthTimezone: dto.birthTimezone,
      birthTimeKnown,
    });
    const token = this.jwtService.sign({ sub: user.id, email: user.email });
    return { user, access_token: token };
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const user = await this.usersService.findByEmail(email);
    if (!user || !(await this.usersService.validatePassword(user, password))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Account is inactive. You cannot log in.');
    }
    const token = this.jwtService.sign({ sub: user.id, email: user.email });
    return { user: this.usersService.toPublic(user), access_token: token };
  }

  async me(userId: string): Promise<UserResponse | null> {
    const user = await this.usersService.findById(userId);
    return user ? this.usersService.toPublic(user) : null;
  }

  async updateProfile(
    userId: string,
    data: { name?: string; email?: string },
  ): Promise<UserResponse> {
    return this.usersService.updateProfile(userId, data);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    await this.usersService.updatePassword(userId, currentPassword, newPassword);
  }
}
