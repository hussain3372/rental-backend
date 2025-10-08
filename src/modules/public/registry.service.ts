import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CertificationStatus } from '@prisma/client';

export interface PublicCertification {
  id: string;
  certificateNumber: string;
  issuedAt: Date;
  expiresAt: Date;
  status: CertificationStatus;
  host: {
    id: number;
    name: string;
  };
  property: {
    name: string;
    address: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
    propertyType: string;
    numberOfGuests: number;
    numberOfBedrooms: number;
    numberOfBeds: number;
    numberOfBathrooms: number;
    description?: string;
    amenities?: string[];
    images?: string[];
  };
  badgeUrl?: string;
  qrCodeUrl?: string;
  verificationUrl: string;
}

export interface SearchFilters {
  query?: string; // General search term
  location?: string; // City, state, or zip
  propertyType?: string;
  minGuests?: number;
  maxGuests?: number;
  amenities?: string[];
  certificationStatus?: CertificationStatus;
  minRating?: number; // Future use
  maxPrice?: number; // Future use
  sortBy?: 'relevance' | 'newest' | 'oldest' | 'name';
  sortOrder?: 'asc' | 'desc';
}

export interface SearchResults {
  certifications: PublicCertification[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  filters: SearchFilters;
  facets: {
    propertyTypes: Array<{ value: string; count: number }>;
    locations: Array<{ value: string; city: string; state: string; count: number }>;
    amenities: Array<{ value: string; count: number }>;
    guestCapacities: Array<{ min: number; max: number; count: number }>;
  };
}

@Injectable()
export class RegistryService {
  constructor(private prisma: PrismaService) {}

  async searchCertifications(
    filters: SearchFilters,
    page: number = 1,
    limit: number = 20
  ): Promise<SearchResults> {
    const skip = (page - 1) * limit;
    const {
      query,
      location,
      propertyType,
      minGuests,
      maxGuests,
      amenities,
      certificationStatus = CertificationStatus.ACTIVE,
      sortBy = 'relevance',
      sortOrder = 'desc'
    } = filters;

    // Build where clause
    const where: any = {
      status: certificationStatus,
      expiresAt: { gt: new Date() }, // Only active certifications
    };

    // Text search across multiple fields
    if (query) {
      where.OR = [
        {
          application: {
            propertyDetails: {
              path: 'propertyName',
              string_contains: query.toLowerCase()
            }
          }
        },
        {
          application: {
            propertyDetails: {
              path: 'description',
              string_contains: query.toLowerCase()
            }
          }
        },
        {
          host: {
            name: {
              contains: query,
              mode: 'insensitive'
            }
          }
        },
        {
          certificateNumber: {
            contains: query.toUpperCase()
          }
        }
      ];
    }

    // Location filter
    if (location) {
      where.application = where.application || {};
      where.application.propertyDetails = where.application.propertyDetails || {};

      const locationLower = location.toLowerCase();
      where.application.propertyDetails.OR = [
        { city: { contains: locationLower, mode: 'insensitive' } },
        { state: { contains: locationLower, mode: 'insensitive' } },
        { zipCode: { contains: locationLower } },
        { country: { contains: locationLower, mode: 'insensitive' } }
      ];
    }

    // Property type filter
    if (propertyType) {
      where.application = where.application || {};
      where.application.propertyDetails = where.application.propertyDetails || {};
      where.application.propertyDetails.propertyType = propertyType;
    }

    // Guest capacity filter
    if (minGuests !== undefined || maxGuests !== undefined) {
      where.application = where.application || {};
      where.application.propertyDetails = where.application.propertyDetails || {};

      if (minGuests !== undefined) {
        where.application.propertyDetails.numberOfGuests = {
          ...where.application.propertyDetails.numberOfGuests,
          gte: minGuests
        };
      }

      if (maxGuests !== undefined) {
        where.application.propertyDetails.numberOfGuests = {
          ...where.application.propertyDetails.numberOfGuests,
          lte: maxGuests
        };
      }
    }

    // Amenities filter (if amenities are stored as array)
    if (amenities && amenities.length > 0) {
      where.application = where.application || {};
      where.application.propertyDetails = where.application.propertyDetails || {};

      // This assumes amenities are stored as JSON array
      // In a real implementation, you might want to normalize this
      where.AND = amenities.map(amenity => ({
        application: {
          propertyDetails: {
            path: 'amenities',
            array_contains: amenity
          }
        }
      }));
    }

    // Build order by
    let orderBy: any = { issuedAt: 'desc' }; // Default

    switch (sortBy) {
      case 'newest':
        orderBy = { issuedAt: 'desc' };
        break;
      case 'oldest':
        orderBy = { issuedAt: 'asc' };
        break;
      case 'name':
        orderBy = {
          application: {
            propertyDetails: {
              propertyName: sortOrder
            }
          }
        };
        break;
      case 'relevance':
      default:
        // For relevance, we could implement a scoring system
        // For now, use newest first
        orderBy = { issuedAt: 'desc' };
        break;
    }

    // Execute search
    const [certifications, total] = await Promise.all([
      this.prisma.certification.findMany({
        where,
        include: {
          application: {
            select: {
              propertyDetails: true,
            }
          },
          host: {
            select: {
              id: true,
              name: true,
            }
          }
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.certification.count({ where }),
    ]);

    // Transform to public format
    const publicCertifications = certifications.map(cert => this.transformToPublic(cert));

    // Generate facets
    const facets = await this.generateFacets(where);

    const totalPages = Math.ceil(total / limit);

    return {
      certifications: publicCertifications,
      total,
      page,
      limit,
      totalPages,
      filters,
      facets,
    };
  }

  async getCertificationById(id: string): Promise<PublicCertification> {
    const certification = await this.prisma.certification.findFirst({
      where: {
        id,
        status: CertificationStatus.ACTIVE,
        expiresAt: { gt: new Date() },
      },
      include: {
        application: {
          select: {
            propertyDetails: true,
          }
        },
        host: {
          select: {
            id: true,
            name: true,
          }
        }
      },
    });

    if (!certification) {
      throw new NotFoundException('Certification not found or expired');
    }

    return this.transformToPublic(certification);
  }

  async getCertificationByCertificateNumber(certificateNumber: string): Promise<PublicCertification> {
    const certification = await this.prisma.certification.findFirst({
      where: {
        certificateNumber: certificateNumber.toUpperCase(),
        status: CertificationStatus.ACTIVE,
        expiresAt: { gt: new Date() },
      },
      include: {
        application: {
          select: {
            propertyDetails: true,
          }
        },
        host: {
          select: {
            id: true,
            name: true,
          }
        }
      },
    });

    if (!certification) {
      throw new NotFoundException('Certificate not found or expired');
    }

    return this.transformToPublic(certification);
  }

  async getFeaturedCertifications(limit: number = 6): Promise<PublicCertification[]> {
    const certifications = await this.prisma.certification.findMany({
      where: {
        status: CertificationStatus.ACTIVE,
        expiresAt: { gt: new Date() },
      },
      include: {
        application: {
          select: {
            propertyDetails: true,
          }
        },
        host: {
          select: {
            id: true,
            name: true,
          }
        }
      },
      orderBy: { issuedAt: 'desc' },
      take: limit,
    });

    return certifications.map(cert => this.transformToPublic(cert));
  }

  async getRegistryStats(): Promise<{
    totalActiveCertifications: number;
    totalCertifiedHosts: number;
    totalCertifiedProperties: number;
    certificationsByState: Array<{ state: string; count: number }>;
    certificationsByPropertyType: Array<{ propertyType: string; count: number }>;
    recentCertifications: PublicCertification[]; // Recent certifications
  }> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      totalActiveCertifications,
      totalCertifiedHosts,
      totalCertifiedProperties,
      certificationsByState,
      certificationsByPropertyType,
      recentCertifications,
    ] = await Promise.all([
      this.prisma.certification.count({
        where: {
          status: CertificationStatus.ACTIVE,
          expiresAt: { gt: new Date() },
        },
      }),
      this.prisma.certification.count({
        where: {
          status: CertificationStatus.ACTIVE,
          expiresAt: { gt: new Date() },
        },
      }),
      this.prisma.certification.count({
        where: {
          status: CertificationStatus.ACTIVE,
          expiresAt: { gt: new Date() },
        },
      }),
      Promise.resolve([]),
      Promise.resolve([]),
      Promise.resolve([]),
    ]);

    return {
      totalActiveCertifications,
      totalCertifiedHosts,
      totalCertifiedProperties,
      certificationsByState: [],
      certificationsByPropertyType: [],
      recentCertifications: [],
    };
  }

  async getCertificationsByLocation(
    city?: string,
    state?: string,
    country?: string,
    limit: number = 50
  ): Promise<PublicCertification[]> {
    const where: any = {
      status: CertificationStatus.ACTIVE,
      expiresAt: { gt: new Date() },
    };

    // Build location filters
    const locationFilters = [];
    if (city) locationFilters.push({ city: { equals: city, mode: 'insensitive' } });
    if (state) locationFilters.push({ state: { equals: state, mode: 'insensitive' } });
    if (country) locationFilters.push({ country: { equals: country, mode: 'insensitive' } });

    if (locationFilters.length > 0) {
      where.application = {
        propertyDetails: {
          AND: locationFilters
        }
      };
    }

    const certifications = await this.prisma.certification.findMany({
      where,
      include: {
        application: {
          select: {
            propertyDetails: true,
          }
        },
        host: {
          select: {
            id: true,
            name: true,
          }
        }
      },
      orderBy: { issuedAt: 'desc' },
      take: limit,
    });

    return certifications.map(cert => this.transformToPublic(cert));
  }

  private transformToPublic(certification: any): PublicCertification {
    const propertyDetails = certification.application?.propertyDetails || {};

    return {
      id: certification.id,
      certificateNumber: certification.certificateNumber,
      issuedAt: certification.issuedAt,
      expiresAt: certification.expiresAt,
      status: certification.status,
      host: {
        id: certification.host.id,
        name: certification.host.name || 'Anonymous Host',
      },
      property: {
        name: propertyDetails.propertyName || 'Property',
        address: propertyDetails.address || '',
        city: propertyDetails.city || '',
        state: propertyDetails.state || '',
        zipCode: propertyDetails.zipCode || '',
        country: propertyDetails.country || '',
        propertyType: propertyDetails.propertyType || '',
        numberOfGuests: propertyDetails.numberOfGuests || 0,
        numberOfBedrooms: propertyDetails.numberOfBedrooms || 0,
        numberOfBeds: propertyDetails.numberOfBeds || 0,
        numberOfBathrooms: propertyDetails.numberOfBathrooms || 0,
        description: propertyDetails.description,
        amenities: propertyDetails.amenities || [],
        images: propertyDetails.images || [],
      },
      badgeUrl: certification.badgeUrl,
      qrCodeUrl: certification.qrCodeUrl,
      verificationUrl: certification.verificationUrl,
    };
  }

  private async generateFacets(baseWhere: any): Promise<SearchResults['facets']> {
    // Generate property type facets
    const propertyTypes = []; // Temporarily disabled raw query

    // Generate location facets
    const locations = []; // Temporarily disabled raw query

    // Generate amenities facets (simplified - would need proper amenities structure)
    const amenities = []; // Placeholder

    // Generate guest capacity facets
    const guestCapacities = []; // Temporarily disabled raw query

    // Transform guest capacities to expected format
    const transformedGuestCapacities = (guestCapacities as any[]).map(item => ({
      min: item.min_guests,
      max: item.max_guests,
      count: parseInt(item.count),
    }));

    return {
      propertyTypes: propertyTypes as Array<{ value: string; count: number }>,
      locations: locations as Array<{ value: string; city: string; state: string; count: number }>,
      amenities,
      guestCapacities: transformedGuestCapacities,
    };
  }
}
