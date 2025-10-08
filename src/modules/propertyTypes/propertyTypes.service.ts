import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface FindAllOptions {
  activeOnly?: boolean;
}

interface CreatePropertyTypeInput {
  name: string;
  description?: string;
  isActive?: boolean;
  defaultChecklist?: Array<{ name: string; description?: string }>;
}

interface UpdatePropertyTypeInput {
  name?: string;
  description?: string;
  isActive?: boolean;
  defaultChecklist?: Array<{ id?: string; name: string; description?: string }>;
}

@Injectable()
export class PropertyTypesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(options: FindAllOptions = {}) {
    const where = options.activeOnly ? { isActive: true } : {};
    return this.prisma.propertyType.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        checklists: { select: { id: true, name: true, description: true } },
      },
    });
  }

  async findOne(id: string) {
    const propertyType = await this.prisma.propertyType.findUnique({
      where: { id },
      include: {
        checklists: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
      },
    });

    if (!propertyType) {
      throw new NotFoundException(`Property type with ID ${id} not found`);
    }

    return propertyType;
  }

  async create(input: CreatePropertyTypeInput) {
    if (!input.name?.trim()) {
      throw new BadRequestException('name is required');
    }

    return this.prisma.$transaction(async tx => {
      const created = await tx.propertyType.create({
        data: {
          name: input.name.trim(),
          description: input.description?.trim(),
          isActive: input.isActive ?? true,
        },
      });

      const checklistItems = input.defaultChecklist?.length
        ? input.defaultChecklist
        : [{ name: 'Default checklist item' }];

      await tx.checklist.createMany({
        data: checklistItems.map(item => ({
          propertyTypeId: created.id,
          name: item.name.trim(),
          description: item.description?.trim(),
        })),
      });

      return tx.propertyType.findUnique({
        where: { id: created.id },
        include: { checklists: true },
      });
    });
  }

  async update(id: string, input: UpdatePropertyTypeInput) {
    const exists = await this.prisma.propertyType.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Property type not found');

    return this.prisma.$transaction(async tx => {
      await tx.propertyType.update({
        where: { id },
        data: {
          name: input.name?.trim(),
          description: input.description?.trim(),
          isActive: input.isActive,
        },
      });

      if (input.defaultChecklist && input.defaultChecklist.length) {
        for (const item of input.defaultChecklist) {
          if (item.id) {
            await tx.checklist.update({
              where: { id: item.id },
              data: {
                name: item.name.trim(),
                description: item.description?.trim(),
              },
            });
          } else {
            await tx.checklist.create({
              data: {
                propertyTypeId: id,
                name: item.name.trim(),
                description: item.description?.trim(),
              },
            });
          }
        }
      }

      return tx.propertyType.findUnique({
        where: { id },
        include: { checklists: true },
      });
    });
  }

  async remove(id: string) {
    const exists = await this.prisma.propertyType.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Property type not found');

    await this.prisma.$transaction(async tx => {
      await tx.checklist.deleteMany({ where: { propertyTypeId: id } });
      await tx.propertyType.delete({ where: { id } });
    });
    return { success: true };
  }
}
