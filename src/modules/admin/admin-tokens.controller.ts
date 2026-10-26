import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { AccessAuth } from '../../common/decorators/access-auth.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { AdminTokensService } from './admin-tokens.service';
import { CreateTokenDto } from './dto/create-token.dto';
import { CreatedTokenDto, TokenListItemDto } from './dto/token-list-item.dto';
import { TokenSummaryDto } from './dto/token-summary.dto';
import { UpdateTokenDto } from './dto/update-token.dto';

@Controller('admin/tokens')
@AccessAuth({ admin: true })
export class AdminTokensController {
  constructor(private readonly tokensService: AdminTokensService) {}

  @Get()
  @ResponseMessage('Tokens retrieved successfully')
  list(): Promise<TokenListItemDto[]> {
    return this.tokensService.list();
  }

  @Post()
  @ResponseMessage('Token created')
  create(@Body() dto: CreateTokenDto): Promise<CreatedTokenDto> {
    return this.tokensService.create(dto);
  }

  @Patch(':id')
  @ResponseMessage('Token updated')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTokenDto,
  ): Promise<TokenListItemDto> {
    return this.tokensService.update(id, dto);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Token revoked')
  revoke(@Param('id') id: string): Promise<TokenListItemDto> {
    return this.tokensService.revoke(id);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Token activated')
  activate(@Param('id') id: string): Promise<TokenListItemDto> {
    return this.tokensService.activate(id);
  }

  @Post(':id/regenerate')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Token regenerated')
  regenerate(@Param('id') id: string): Promise<CreatedTokenDto> {
    return this.tokensService.regenerate(id);
  }

  @Delete(':id/sessions')
  @ResponseMessage('Devices reset')
  resetSessions(@Param('id') id: string): Promise<TokenListItemDto> {
    return this.tokensService.resetSessions(id);
  }

  @Delete(':id')
  @ResponseMessage('Token deleted')
  async remove(@Param('id') id: string): Promise<null> {
    await this.tokensService.remove(id);
    return null;
  }

  @Get(':id/summary')
  @ResponseMessage('Token summary retrieved successfully')
  summary(@Param('id') id: string): Promise<TokenSummaryDto> {
    return this.tokensService.summary(id);
  }
}
