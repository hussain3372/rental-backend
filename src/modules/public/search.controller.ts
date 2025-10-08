import {
  Controller,
  Get,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  ParseFloatPipe,
  ParseBoolPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { SearchService, AdvancedSearchFilters } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get('advanced')
  @HttpCode(HttpStatus.OK)
  advancedSearch(
    // Basic filters
    @Query('q') query?: string,
    @Query('location') location?: string,
    @Query('propertyType') propertyType?: string,

    // Numeric range filters
    @Query('minGuests') minGuests?: string,
    @Query('maxGuests') maxGuests?: string,
    @Query('minBedrooms') minBedrooms?: string,
    @Query('maxBedrooms') maxBedrooms?: string,
    @Query('minBeds') minBeds?: string,
    @Query('maxBeds') maxBeds?: string,
    @Query('minBathrooms') minBathrooms?: string,
    @Query('maxBathrooms') maxBathrooms?: string,

    // Amenities (comma-separated)
    @Query('amenities') amenitiesQuery?: string,

    // Geographic filters
    @Query('lat') latitude?: string,
    @Query('lng') longitude?: string,
    @Query('radius') radius?: string,

    // Bounding box (north,south,east,west)
    @Query('bbox') boundingBoxQuery?: string,

    // Date filters
    @Query('issuedAfter') issuedAfter?: string,
    @Query('issuedBefore') issuedBefore?: string,
    @Query('expiresAfter') expiresAfter?: string,
    @Query('expiresBefore') expiresBefore?: string,

    // Boolean filters
    @Query('hasImages') hasImages?: string,
    @Query('hasAmenities') hasAmenities?: string,

    // Search options
    @Query('searchInDescription') searchInDescription?: string,
    @Query('searchInAmenities') searchInAmenities?: string,
    @Query('fuzzySearch') fuzzySearch?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('highlightMatches') highlightMatches?: string,

    // Sorting and pagination
    @Query('sortBy')
    sortBy?: 'relevance' | 'newest' | 'oldest' | 'name' | 'guests',
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    @Query('page') page?: string,
    @Query('limit') limit?: string,

    // Suggestions
    @Query('includeSuggestions') includeSuggestions?: string
  ) {
    const toInt = (v?: string) =>
      v === undefined || v === null || v.trim() === '' || isNaN(Number(v))
        ? undefined
        : Number(v);
    const toFloat = (v?: string) =>
      v === undefined || v === null || v.trim() === '' || isNaN(Number(v))
        ? undefined
        : Number(v);
    const toBool = (v?: string) =>
      v === undefined || v === null || v.trim() === ''
        ? undefined
        : v.toLowerCase() === 'true'
          ? true
          : v.toLowerCase() === 'false'
            ? false
            : undefined;
    // Parse bounding box if provided
    let boundingBox;
    if (boundingBoxQuery) {
      const [north, south, east, west] = boundingBoxQuery
        .split(',')
        .map(parseFloat);
      if (north && south && east && west) {
        boundingBox = { north, south, east, west };
      }
    }

    const filters: AdvancedSearchFilters = {
      // Basic filters
      query,
      location,
      propertyType,

      // Numeric ranges
      minGuests: toInt(minGuests),
      maxGuests: toInt(maxGuests),
      minBedrooms: toInt(minBedrooms),
      maxBedrooms: toInt(maxBedrooms),
      minBeds: toInt(minBeds),
      maxBeds: toInt(maxBeds),
      minBathrooms: toInt(minBathrooms),
      maxBathrooms: toInt(maxBathrooms),

      // Amenities
      amenities: amenitiesQuery
        ? amenitiesQuery.split(',').map(a => a.trim())
        : undefined,

      // Geographic
      latitude: toFloat(latitude),
      longitude: toFloat(longitude),
      radius: toFloat(radius),
      boundingBox,

      // Dates
      issuedAfter: issuedAfter ? new Date(issuedAfter) : undefined,
      issuedBefore: issuedBefore ? new Date(issuedBefore) : undefined,
      expiresAfter: expiresAfter ? new Date(expiresAfter) : undefined,
      expiresBefore: expiresBefore ? new Date(expiresBefore) : undefined,

      // Booleans
      hasImages: toBool(hasImages),
      hasAmenities: toBool(hasAmenities),

      // Search options
      searchInDescription: toBool(searchInDescription),
      searchInAmenities: toBool(searchInAmenities),
      fuzzySearch: toBool(fuzzySearch),
      includeInactive: toBool(includeInactive),
      highlightMatches: toBool(highlightMatches),

      // Sorting
      sortBy,
      sortOrder,
    };

    const effectivePage = toInt(page) ?? 1;
    const effectiveLimit = Math.min(toInt(limit) ?? 20, 100);
    const effectiveIncludeSuggestions = toBool(includeSuggestions) ?? false;

    return this.searchService.advancedSearch(
      filters,
      effectivePage,
      effectiveLimit,
      effectiveIncludeSuggestions
    );
  }

  @Get('suggestions')
  @HttpCode(HttpStatus.OK)
  getSearchSuggestions(
    @Query('q') query: string,
    @Query('limit') limit?: string
  ) {
    if (!query) {
      return { suggestions: [] };
    }

    const effectiveLimit = Math.min(Number(limit) || 10, 100);

    return this.searchService
      .getSearchSuggestions(
        query,
        undefined // Could pass context filters here
      )
      .then(suggestions => ({
        suggestions: suggestions.slice(0, effectiveLimit),
        query,
      }));
  }

  @Get('popular')
  @HttpCode(HttpStatus.OK)
  getPopularSearches(@Query('limit') limit?: string) {
    const effectiveLimit = Math.min(Number(limit) || 10, 100);
    return this.searchService.getPopularSearches(effectiveLimit);
  }

  @Get('analytics')
  @HttpCode(HttpStatus.OK)
  getSearchAnalytics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    const start = startDate
      ? new Date(startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    return this.searchService.getSearchAnalytics(start, end);
  }

  // Quick search endpoints for common use cases
  @Get('quick/property-types')
  @HttpCode(HttpStatus.OK)
  async getPropertyTypes() {
    const results = await this.searchService.advancedSearch({}, 1, 1);
    return {
      propertyTypes: results.facets.propertyTypes.map(pt => ({
        value: pt.value,
        label: `${pt.value} (${pt.count})`,
        count: pt.count,
      })),
    };
  }

  @Get('quick/locations')
  @HttpCode(HttpStatus.OK)
  async getPopularLocations(@Query('limit') limit?: string) {
    const results = await this.searchService.advancedSearch({}, 1, 1);
    return {
      locations: results.facets.locations
        .slice(0, Number(limit) || 20)
        .map(loc => ({
          value: loc.value,
          label: `${loc.value} (${loc.count})`,
          count: loc.count,
          city: loc.city,
          state: loc.state,
        })),
    };
  }

  @Get('quick/amenities')
  @HttpCode(HttpStatus.OK)
  async getPopularAmenities(@Query('limit') limit?: string) {
    const results = await this.searchService.advancedSearch({}, 1, 1);
    return {
      amenities: results.facets.amenities
        .slice(0, Number(limit) || 20)
        .map(amenity => ({
          value: amenity.value,
          label: `${amenity.value} (${amenity.count})`,
          count: amenity.count,
        })),
    };
  }

  // Comparison search - find similar properties
  @Get('similar/:certificationId')
  @HttpCode(HttpStatus.OK)
  async findSimilarProperties(
    @Param('certificationId') certificationId: string,
    @Query('limit') limit?: string
  ) {
    // Get the base certification
    const registryService = (this.searchService as any).registryService;
    const baseCert =
      await registryService.getCertificationById(certificationId);

    // Build similarity filters based on the base certification
    const filters: AdvancedSearchFilters = {
      propertyType: baseCert.property.propertyType,
      minGuests: Math.max(1, baseCert.property.numberOfGuests - 2),
      maxGuests: baseCert.property.numberOfGuests + 2,
      location: `${baseCert.property.city}, ${baseCert.property.state}`,
      excludedHostIds: [baseCert.host.id], // Exclude same host
    };

    const results = await this.searchService.advancedSearch(
      filters,
      1,
      Number(limit) || 5
    );

    return {
      baseCertification: baseCert,
      similarCertifications: results.certifications,
      totalSimilar: results.total,
    };
  }

  // Search templates for common searches
  @Get('templates')
  @HttpCode(HttpStatus.OK)
  getSearchTemplates() {
    return {
      templates: [
        {
          id: 'vacation-rental',
          name: 'Vacation Rentals',
          description: 'Find certified vacation rental properties',
          filters: {
            propertyType: 'House',
            minGuests: 4,
            hasImages: true,
          },
        },
        {
          id: 'business-travel',
          name: 'Business Travel',
          description: 'Properties suitable for business travelers',
          filters: {
            amenities: ['WiFi', 'Workspace'],
            minGuests: 1,
            maxGuests: 2,
          },
        },
        {
          id: 'family-friendly',
          name: 'Family Friendly',
          description: 'Spacious properties for families',
          filters: {
            minGuests: 6,
            minBedrooms: 3,
            amenities: ['Pool', 'Kitchen'],
          },
        },
        {
          id: 'luxury-stays',
          name: 'Luxury Properties',
          description: 'High-end certified accommodations',
          filters: {
            minBedrooms: 4,
            minBathrooms: 3,
            amenities: ['Pool', 'Hot Tub', 'Gym'],
          },
        },
        {
          id: 'recently-certified',
          name: 'Recently Certified',
          description: 'Newly certified properties',
          filters: {
            issuedAfter: new Date(
              Date.now() - 30 * 24 * 60 * 60 * 1000
            ).toISOString(),
            sortBy: 'newest',
          },
        },
      ],
    };
  }

  @Get('template/:templateId')
  @HttpCode(HttpStatus.OK)
  async executeSearchTemplate(
    @Param('templateId') templateId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const templates = await this.getSearchTemplates();
    const template = templates.templates.find(t => t.id === templateId);

    if (!template) {
      throw new Error(`Search template '${templateId}' not found`);
    }

    // Convert template filters to AdvancedSearchFilters
    const filters: AdvancedSearchFilters = {
      ...(template.filters as any),
      // Convert date strings to Date objects
      issuedAfter: template.filters.issuedAfter
        ? new Date(template.filters.issuedAfter as any)
        : undefined,
    };

    return this.searchService.advancedSearch(
      filters,
      Number(page) || 1,
      Number(limit) || 20,
      true // Include suggestions
    );
  }
}
