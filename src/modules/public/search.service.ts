import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegistryService, PublicCertification, SearchFilters } from './registry.service';

export interface AdvancedSearchFilters {
  // Basic search filters (from SearchFilters)
  query?: string; // General search term
  location?: string; // City, state, or zip
  propertyType?: string;
  minGuests?: number;
  maxGuests?: number;
  amenities?: string[];
  certificationStatus?: string;
  minRating?: number; // Future use
  maxPrice?: number; // Future use

  // Geographic filters
  latitude?: number;
  longitude?: number;
  radius?: number; // in miles
  boundingBox?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };

  // Date range filters
  issuedAfter?: Date;
  issuedBefore?: Date;
  expiresAfter?: Date;
  expiresBefore?: Date;

  // Numeric range filters
  minBedrooms?: number;
  maxBedrooms?: number;
  minBeds?: number;
  maxBeds?: number;
  minBathrooms?: number;
  maxBathrooms?: number;

  // Boolean filters
  hasImages?: boolean;
  hasAmenities?: boolean;

  // Multi-select filters
  hostIds?: number[];
  excludedHostIds?: number[];

  // Text search options
  searchInDescription?: boolean;
  searchInAmenities?: boolean;
  fuzzySearch?: boolean;

  // Result customization
  includeInactive?: boolean; // Include expired/revoked for admin use
  highlightMatches?: boolean;

  // Sorting
  sortBy?: 'name' | 'relevance' | 'newest' | 'oldest' | 'guests';
  sortOrder?: 'asc' | 'desc';
}

export interface SearchSuggestion {
  type: 'property' | 'location' | 'host' | 'certificate';
  value: string;
  label: string;
  count?: number;
  metadata?: any;
}

export interface AdvancedSearchResults {
  certifications: PublicCertification[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  searchTime: number;
  suggestions?: SearchSuggestion[];
  highlightedTerms?: string[];
  facets: {
    propertyTypes: Array<{ value: string; count: number; selected?: boolean }>;
    locations: Array<{ value: string; city: string; state: string; count: number; selected?: boolean }>;
    amenities: Array<{ value: string; count: number; selected?: boolean }>;
    guestCapacities: Array<{ min: number; max: number; count: number; selected?: boolean }>;
    priceRanges?: Array<{ min: number; max: number; count: number; selected?: boolean }>; // Future use
    hostRatings?: Array<{ min: number; max: number; count: number; selected?: boolean }>; // Future use
  };
  appliedFilters: AdvancedSearchFilters;
}

@Injectable()
export class SearchService {
  constructor(
    private prisma: PrismaService,
    private registryService: RegistryService,
  ) {}

  async advancedSearch(
    filters: AdvancedSearchFilters,
    page: number = 1,
    limit: number = 20,
    includeSuggestions: boolean = false
  ): Promise<AdvancedSearchResults> {
    const startTime = Date.now();

    // Build comprehensive search query
    const whereClause = await this.buildSearchWhereClause(filters);

    // Execute search with performance monitoring
    const [certifications, total] = await Promise.all([
      this.executeSearchQuery(whereClause, filters, page, limit),
      this.getSearchTotal(whereClause, filters),
    ]);

    // Transform results
    const publicCertifications = certifications.map(cert =>
      this.registryService['transformToPublic'](cert)
    );

    // Generate facets based on search results
    const facets = await this.generateAdvancedFacets(whereClause, filters);

    // Generate suggestions if requested
    let suggestions: SearchSuggestion[] | undefined;
    if (includeSuggestions && filters.query) {
      suggestions = await this.generateSearchSuggestions(filters.query, whereClause);
    }

    // Extract highlighted terms
    const highlightedTerms = this.extractHighlightedTerms(filters);

    const searchTime = Date.now() - startTime;
    const totalPages = Math.ceil(total / limit);

    return {
      certifications: publicCertifications,
      total,
      page,
      limit,
      totalPages,
      searchTime,
      suggestions,
      highlightedTerms,
      facets,
      appliedFilters: filters,
    };
  }

  async getSearchSuggestions(
    query: string,
    contextFilters?: Partial<AdvancedSearchFilters>
  ): Promise<SearchSuggestion[]> {
    const suggestions: SearchSuggestion[] = [];

    if (!query || query.length < 2) {
      return suggestions;
    }

    // Property name suggestions
    const propertySuggestions = await this.prisma.$queryRaw`
      SELECT
        'property' as type,
        (application->'propertyDetails'->>'propertyName') as value,
        (application->'propertyDetails'->>'propertyName') as label,
        COUNT(*) as count
      FROM certifications c
      JOIN applications a ON c.applicationId = a.id
      WHERE c.status = 'ACTIVE'
        AND c.expiresAt > NOW()
        AND (application->'propertyDetails'->>'propertyName') ILIKE ${`%${query}%`}
      GROUP BY application->'propertyDetails'->>'propertyName'
      ORDER BY count DESC, length(application->'propertyDetails'->>'propertyName')
      LIMIT 5
    `;

    // Location suggestions
    const locationSuggestions = await this.prisma.$queryRaw`
      SELECT
        'location' as type,
        CONCAT(
          COALESCE(application->'propertyDetails'->>'city', ''),
          ', ',
          COALESCE(application->'propertyDetails'->>'state', '')
        ) as value,
        CONCAT(
          COALESCE(application->'propertyDetails'->>'city', ''),
          ', ',
          COALESCE(application->'propertyDetails'->>'state', ''),
          ' (', COUNT(*), ')'
        ) as label,
        COUNT(*) as count,
        application->'propertyDetails'->>'city' as city,
        application->'propertyDetails'->>'state' as state
      FROM certifications c
      JOIN applications a ON c.applicationId = a.id
      WHERE c.status = 'ACTIVE'
        AND c.expiresAt > NOW()
        AND (
          (application->'propertyDetails'->>'city') ILIKE ${`%${query}%`} OR
          (application->'propertyDetails'->>'state') ILIKE ${`%${query}%`}
        )
      GROUP BY
        application->'propertyDetails'->>'city',
        application->'propertyDetails'->>'state'
      ORDER BY count DESC
      LIMIT 5
    `;

    // Host name suggestions
    const hostSuggestions = await this.prisma.$queryRaw`
      SELECT
        'host' as type,
        h.name as value,
        CONCAT(h.name, ' (', COUNT(*), ' properties)') as label,
        COUNT(*) as count
      FROM certifications c
      JOIN users h ON c.hostId = h.id
      JOIN applications a ON c.applicationId = a.id
      WHERE c.status = 'ACTIVE'
        AND c.expiresAt > NOW()
        AND h.name ILIKE ${`%${query}%`}
      GROUP BY h.id, h.name
      ORDER BY count DESC
      LIMIT 3
    `;

    // Certificate number suggestions (for exact matches)
    const certSuggestions = await this.prisma.certification.findMany({
      where: {
        certificateNumber: {
          contains: query.toUpperCase(),
          mode: 'insensitive',
        },
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
      },
      select: {
        certificateNumber: true,
      },
      take: 3,
    });

    // Add all suggestions
    suggestions.push(
      ...(propertySuggestions as SearchSuggestion[]),
      ...(locationSuggestions as SearchSuggestion[]),
      ...(hostSuggestions as SearchSuggestion[]),
      ...certSuggestions.map(cert => ({
        type: 'certificate' as const,
        value: cert.certificateNumber,
        label: `Certificate ${cert.certificateNumber}`,
      }))
    );

    // Remove duplicates and limit total
    const uniqueSuggestions = this.deduplicateSuggestions(suggestions);
    return uniqueSuggestions.slice(0, 10);
  }

  async getPopularSearches(limit: number = 10): Promise<Array<{ term: string; count: number }>> {
    // This would typically come from a search analytics table
    // For now, return some common search terms based on data
    const popularLocations = await this.prisma.$queryRaw`
      SELECT
        CONCAT(
          COALESCE(application->'propertyDetails'->>'city', ''),
          ', ',
          COALESCE(application->'propertyDetails'->>'state', '')
        ) as term,
        COUNT(*) as count
      FROM certifications c
      JOIN applications a ON c.applicationId = a.id
      WHERE c.status = 'ACTIVE'
        AND c.expiresAt > NOW()
        AND application->'propertyDetails'->>'city' IS NOT NULL
        AND application->'propertyDetails'->>'state' IS NOT NULL
      GROUP BY application->'propertyDetails'->>'city', application->'propertyDetails'->>'state'
      ORDER BY count DESC
      LIMIT ${limit}
    `;

    return (popularLocations as Array<{ term: string; count: number }>).map(item => ({
      term: item.term,
      count: parseInt(item.count.toString()),
    }));
  }

  async getSearchAnalytics(
    startDate: Date,
    endDate: Date
  ): Promise<{
    totalSearches: number;
    popularQueries: Array<{ query: string; count: number }>;
    searchTrends: Array<{ date: string; searches: number }>;
    noResultsQueries: Array<{ query: string; count: number }>;
    averageResultsPerSearch: number;
  }> {
    // This would typically query a search analytics table
    // For now, return mock data based on available certifications

    const totalCertifications = await this.prisma.certification.count({
      where: {
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
      },
    });

    // Mock popular queries based on actual data
    const popularQueries = await this.getPopularSearches(10);

    // Mock search trends (would need actual analytics)
    const searchTrends = [];
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      searchTrends.push({
        date: currentDate.toISOString().split('T')[0],
        searches: Math.floor(Math.random() * 100) + 50, // Mock data
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Transform popularQueries to match interface
    const transformedPopularQueries = popularQueries.map(item => ({
      query: item.term,
      count: item.count,
    }));

    return {
      totalSearches: Math.floor(totalCertifications * 2.5), // Mock multiplier
      popularQueries: transformedPopularQueries,
      searchTrends,
      noResultsQueries: [], // Would need analytics to track
      averageResultsPerSearch: Math.floor(totalCertifications / 10),
    };
  }

  private async buildSearchWhereClause(filters: AdvancedSearchFilters): Promise<any> {
    const where: any = {
      status: filters.includeInactive ? undefined : 'ACTIVE',
    };

    if (!filters.includeInactive) {
      where.expiresAt = { gt: new Date() };
    }

    // Host filters
    if (filters.hostIds && filters.hostIds.length > 0) {
      where.hostId = { in: filters.hostIds };
    }

    if (filters.excludedHostIds && filters.excludedHostIds.length > 0) {
      where.hostId = { ...where.hostId, notIn: filters.excludedHostIds };
    }

    // Application-based filters
    const applicationWhere: any = {};

    // Text search
    if (filters.query) {
      const searchConditions = [];

      // Search in property name
      searchConditions.push({
        application: {
          propertyDetails: {
            path: 'propertyName',
            string_contains: filters.fuzzySearch
              ? filters.query.toLowerCase()
              : filters.query,
          }
        }
      });

      // Search in certificate number
      searchConditions.push({
        certificateNumber: {
          contains: filters.query,
          mode: 'insensitive'
        }
      });

      // Search in host name
      searchConditions.push({
        host: {
          name: {
            contains: filters.query,
            mode: 'insensitive'
          }
        }
      });

      // Search in description if enabled
      if (filters.searchInDescription) {
        searchConditions.push({
          application: {
            propertyDetails: {
              path: 'description',
              string_contains: filters.query.toLowerCase()
            }
          }
        });
      }

      where.OR = searchConditions;
    }

    // Location filters
    if (filters.location) {
      applicationWhere.propertyDetails = applicationWhere.propertyDetails || {};
      applicationWhere.propertyDetails.OR = [
        { city: { contains: filters.location, mode: 'insensitive' } },
        { state: { contains: filters.location, mode: 'insensitive' } },
        { zipCode: { contains: filters.location } },
        { address: { contains: filters.location, mode: 'insensitive' } }
      ];
    }

    // Geographic filters (if latitude/longitude provided)
    if (filters.latitude && filters.longitude && filters.radius) {
      // This would require geographic functions - simplified for now
      // In production, you'd use PostGIS or similar
      applicationWhere.propertyDetails = applicationWhere.propertyDetails || {};
      // Add geographic bounding box logic here
    }

    // Property filters
    if (filters.propertyType) {
      applicationWhere.propertyDetails = applicationWhere.propertyDetails || {};
      applicationWhere.propertyDetails.propertyType = filters.propertyType;
    }

    // Guest/Bedroom/Bathroom filters
    if (filters.minGuests || filters.maxGuests) {
      applicationWhere.propertyDetails = applicationWhere.propertyDetails || {};
      applicationWhere.propertyDetails.numberOfGuests = {};
      if (filters.minGuests) applicationWhere.propertyDetails.numberOfGuests.gte = filters.minGuests;
      if (filters.maxGuests) applicationWhere.propertyDetails.numberOfGuests.lte = filters.maxGuests;
    }

    if (filters.minBedrooms || filters.maxBedrooms) {
      applicationWhere.propertyDetails = applicationWhere.propertyDetails || {};
      applicationWhere.propertyDetails.numberOfBedrooms = {};
      if (filters.minBedrooms) applicationWhere.propertyDetails.numberOfBedrooms.gte = filters.minBedrooms;
      if (filters.maxBedrooms) applicationWhere.propertyDetails.numberOfBedrooms.lte = filters.maxBedrooms;
    }

    if (filters.minBathrooms || filters.maxBathrooms) {
      applicationWhere.propertyDetails = applicationWhere.propertyDetails || {};
      applicationWhere.propertyDetails.numberOfBathrooms = {};
      if (filters.minBathrooms) applicationWhere.propertyDetails.numberOfBathrooms.gte = filters.minBathrooms;
      if (filters.maxBathrooms) applicationWhere.propertyDetails.numberOfBathrooms.lte = filters.maxBathrooms;
    }

    // Amenities filter
    if (filters.amenities && filters.amenities.length > 0) {
      applicationWhere.AND = filters.amenities.map(amenity => ({
        application: {
          propertyDetails: {
            path: 'amenities',
            array_contains: amenity
          }
        }
      }));
    }

    // Content filters
    if (filters.hasImages) {
      applicationWhere.propertyDetails = applicationWhere.propertyDetails || {};
      applicationWhere.propertyDetails.images = { not: null };
    }

    if (filters.hasAmenities) {
      applicationWhere.propertyDetails = applicationWhere.propertyDetails || {};
      applicationWhere.propertyDetails.amenities = { not: null };
    }

    // Date filters
    if (filters.issuedAfter || filters.issuedBefore) {
      where.issuedAt = {};
      if (filters.issuedAfter) where.issuedAt.gte = filters.issuedAfter;
      if (filters.issuedBefore) where.issuedAt.lte = filters.issuedBefore;
    }

    if (filters.expiresAfter || filters.expiresBefore) {
      where.expiresAt = {};
      if (filters.expiresAfter) where.expiresAt.gte = filters.expiresAfter;
      if (filters.expiresBefore) where.expiresAt.lte = filters.expiresBefore;
    }

    // Apply application filters
    if (Object.keys(applicationWhere).length > 0) {
      where.application = applicationWhere;
    }

    return where;
  }

  private async executeSearchQuery(
    whereClause: any,
    filters: AdvancedSearchFilters,
    page: number,
    limit: number
  ): Promise<any[]> {
    const skip = (page - 1) * limit;
    const orderBy = this.buildOrderByClause(filters.sortBy, filters.sortOrder);

    return await this.prisma.certification.findMany({
      where: whereClause,
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
    });
  }

  private async getSearchTotal(whereClause: any, filters: AdvancedSearchFilters): Promise<number> {
    return await this.prisma.certification.count({ where: whereClause });
  }

  private buildOrderByClause(sortBy?: string, sortOrder?: string): any {
    const order = sortOrder === 'desc' ? 'desc' : 'asc';

    switch (sortBy) {
      case 'newest':
        return { issuedAt: 'desc' };
      case 'oldest':
        return { issuedAt: 'asc' };
      case 'name':
        return {
          application: {
            propertyDetails: {
              propertyName: order
            }
          }
        };
      case 'guests':
        return {
          application: {
            propertyDetails: {
              numberOfGuests: order
            }
          }
        };
      case 'relevance':
      default:
        return { issuedAt: 'desc' };
    }
  }

  private async generateAdvancedFacets(
    whereClause: any,
    appliedFilters: AdvancedSearchFilters
  ): Promise<AdvancedSearchResults['facets']> {
    // This is a simplified version - in production, you'd cache these results
    const baseFacets = await this.registryService['generateFacets'](whereClause);

    // Mark selected facets
    return {
      propertyTypes: baseFacets.propertyTypes.map(pt => ({
        ...pt,
        selected: appliedFilters.propertyType === pt.value,
      })),
      locations: baseFacets.locations.map(loc => ({
        ...loc,
        selected: appliedFilters.location === loc.value,
      })),
      amenities: baseFacets.amenities.map(amenity => ({
        ...amenity,
        selected: appliedFilters.amenities?.includes(amenity.value),
      })),
      guestCapacities: baseFacets.guestCapacities.map(capacity => ({
        ...capacity,
        selected: (appliedFilters.minGuests !== undefined && appliedFilters.minGuests >= capacity.min) ||
                 (appliedFilters.maxGuests !== undefined && appliedFilters.maxGuests <= capacity.max),
      })),
    };
  }

  private async generateSearchSuggestions(
    query: string,
    whereClause: any
  ): Promise<SearchSuggestion[]> {
    return await this.getSearchSuggestions(query);
  }

  private extractHighlightedTerms(filters: AdvancedSearchFilters): string[] {
    const terms: string[] = [];

    if (filters.query) {
      terms.push(filters.query);
    }

    if (filters.location) {
      terms.push(filters.location);
    }

    if (filters.amenities) {
      terms.push(...filters.amenities);
    }

    return [...new Set(terms)]; // Remove duplicates
  }

  private deduplicateSuggestions(suggestions: SearchSuggestion[]): SearchSuggestion[] {
    const seen = new Set<string>();
    return suggestions.filter(suggestion => {
      const key = `${suggestion.type}:${suggestion.value}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
}
