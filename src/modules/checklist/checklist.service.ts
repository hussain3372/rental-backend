import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface CreateChecklistInput {
  propertyTypeId: string;
  name: string;
  description?: string;
}

interface UpdateChecklistInput {
  name?: string;
  description?: string;
  checked?: boolean;
}

@Injectable()
export class ChecklistService {
  constructor(private readonly prisma: PrismaService) {}

  async findByPropertyType(propertyTypeId: string) {
    return this.prisma.checklist.findMany({
      where: { propertyTypeId },
      orderBy: { name: 'asc' },
    });
  }

  async create(input: CreateChecklistInput) {
    if (!input.propertyTypeId) throw new BadRequestException('propertyTypeId is required');
    if (!input.name?.trim()) throw new BadRequestException('name is required');

    const exists = await this.prisma.propertyType.findUnique({ where: { id: input.propertyTypeId } });
    if (!exists) throw new NotFoundException('Property type not found');

    return this.prisma.checklist.create({
      data: {
        propertyTypeId: input.propertyTypeId,
        name: input.name.trim(),
        description: input.description?.trim(),
      },
    });
  }

  async update(id: string, input: UpdateChecklistInput) {
    const exists = await this.prisma.checklist.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Checklist item not found');

    return this.prisma.checklist.update({
      where: { id },
      data: {
        name: input.name?.trim(),
        description: input.description?.trim(),
        checked: input.checked,
      },
    });
  }

  async remove(id: string) {
    const exists = await this.prisma.checklist.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Checklist item not found');
    await this.prisma.checklist.delete({ where: { id } });
    return { success: true };
  }
}
