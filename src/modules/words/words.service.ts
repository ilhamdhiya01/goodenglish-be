import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LEVEL_WIRE, levelFromDb } from '../../common/token/access-enums';
import type { AccessContext } from '../../common/types/access-context';
import { Level, SharedWord } from '../../generated/prisma/client';
import { CreateWordDto } from './dto/create-word.dto';
import { UpdateWordDto } from './dto/update-word.dto';
import { WordDto } from './dto/word.dto';

@Injectable()
export class WordsService {
  constructor(private readonly prisma: PrismaService) {}

  // Learners only get the levels their token may open; admins get all.
  async listFor(access: AccessContext): Promise<WordDto[]> {
    const words = await this.prisma.sharedWord.findMany({
      where: access.role === 'ADMIN' ? {} : { level: { in: access.levels } },
      orderBy: [{ level: 'asc' }, { week: 'asc' }, { createdAt: 'asc' }],
    });
    return words.map((w) => this.toDto(w));
  }

  async create(dto: CreateWordDto): Promise<WordDto> {
    const level = LEVEL_WIRE[dto.level];
    const en = dto.en.trim();
    await this.assertUnique(level, en);
    const word = await this.prisma.sharedWord.create({
      data: {
        level,
        week: dto.week,
        type: dto.type,
        en,
        meaning: dto.meaning.trim(),
        pron: dto.pron?.trim() ?? '',
        example: dto.example?.trim() ?? '',
      },
    });
    return this.toDto(word);
  }

  async update(id: string, dto: UpdateWordDto): Promise<WordDto> {
    const current = await this.findOrThrow(id);
    const level = dto.level ? LEVEL_WIRE[dto.level] : current.level;
    const en = dto.en !== undefined ? dto.en.trim() : current.en;
    if (
      level !== current.level ||
      en.toLowerCase() !== current.en.toLowerCase()
    )
      await this.assertUnique(level, en, id);

    const word = await this.prisma.sharedWord.update({
      where: { id },
      data: {
        level,
        en,
        ...(dto.week !== undefined ? { week: dto.week } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.meaning !== undefined ? { meaning: dto.meaning.trim() } : {}),
        ...(dto.pron !== undefined ? { pron: dto.pron.trim() } : {}),
        ...(dto.example !== undefined ? { example: dto.example.trim() } : {}),
      },
    });
    return this.toDto(word);
  }

  async remove(id: string): Promise<void> {
    await this.findOrThrow(id);
    await this.prisma.sharedWord.delete({ where: { id } });
  }

  private async findOrThrow(id: string): Promise<SharedWord> {
    const word = await this.prisma.sharedWord.findUnique({ where: { id } });
    if (!word) {
      throw new NotFoundException({ field: 'id', message: 'word_not_found' });
    }
    return word;
  }

  // One spelling per level, case-insensitively. Words bundled in the frontend
  // aren't known here; the admin form checks those before submitting.
  private async assertUnique(level: Level, en: string, exceptId?: string) {
    const clash = await this.prisma.sharedWord.findFirst({
      where: {
        level,
        en: { equals: en, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw new UnprocessableEntityException({
        field: 'en',
        message: 'word_exists',
      });
    }
  }

  private toDto(w: SharedWord): WordDto {
    return new WordDto({
      id: w.id,
      level: levelFromDb(w.level),
      week: w.week,
      type: w.type,
      en: w.en,
      meaning: w.meaning,
      pron: w.pron,
      example: w.example,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    });
  }
}
