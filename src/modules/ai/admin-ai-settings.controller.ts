import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
} from '@nestjs/common';
import { AccessAuth } from '../../common/decorators/access-auth.decorator';
import { CurrentAccess } from '../../common/decorators/current-access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import type { AccessContext } from '../../common/types/access-context';
import { AiSettingsService } from './ai-settings.service';
import {
  AiModelsDto,
  AiSettingsDto,
  PreviewModelsDto,
  SaveAiSettingsDto,
} from './dto/ai-settings.dto';

@Controller('admin/ai-settings')
@AccessAuth({ admin: true })
export class AdminAiSettingsController {
  constructor(private readonly settings: AiSettingsService) {}

  @Get()
  @ResponseMessage('AI settings retrieved successfully')
  get(): Promise<AiSettingsDto> {
    return this.settings.summary();
  }

  @Put()
  @ResponseMessage('AI settings saved')
  save(
    @CurrentAccess() access: AccessContext,
    @Body() dto: SaveAiSettingsDto,
  ): Promise<AiSettingsDto> {
    return this.settings.save(dto, access.label);
  }

  @Delete('key')
  @ResponseMessage('AI key removed')
  removeKey(@CurrentAccess() access: AccessContext): Promise<AiSettingsDto> {
    return this.settings.removeKey(access.label);
  }

  @Get('models')
  @ResponseMessage('AI models retrieved successfully')
  models(): Promise<AiModelsDto> {
    return this.settings.listModels();
  }

  // Models for a key typed in the form, before it's saved.
  @Post('models/preview')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('AI models retrieved successfully')
  preview(@Body() dto: PreviewModelsDto): Promise<AiModelsDto> {
    return this.settings.listModels(dto.apiKey);
  }
}
