import {
  Controller,
  Get,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { RegistryService, SearchFilters } from './registry.service';

@ApiTags('registry')
@Controller('registry')
export class RegistryController {
  constructor(private readonly registryService: RegistryService) {}

  @Get('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Search certified hosts and properties' })
  @ApiResponse({ status: 200, description: 'Search results returned successfully' })
  searchCertifications(
    @Query('q') query?: string,
    @Query('location') location?: string,
    @Query('propertyType') propertyType?: string,
    @Query('minGuests', ParseIntPipe) minGuests?: number,
    @Query('maxGuests', ParseIntPipe) maxGuests?: number,
    @Query('amenities') amenitiesQuery?: string, // comma-separated
    @Query('sortBy') sortBy?: 'relevance' | 'newest' | 'oldest' | 'name',
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    @Query('page', ParseIntPipe) page?: number,
    @Query('limit', ParseIntPipe) limit?: number,
  ) {
    const filters: SearchFilters = {
      query,
      location,
      propertyType,
      minGuests,
      maxGuests,
      amenities: amenitiesQuery ? amenitiesQuery.split(',').map(a => a.trim()) : undefined,
      sortBy,
      sortOrder,
    };

    return this.registryService.searchCertifications(
      filters,
      page || 1,
      Math.min(limit || 20, 100) // Max 100 results per page
    );
  }

  @Get('featured')
  @HttpCode(HttpStatus.OK)
  getFeaturedCertifications(
    @Query('limit', ParseIntPipe) limit?: number,
  ) {
    return this.registryService.getFeaturedCertifications(
      Math.min(limit || 6, 20) // Max 20 featured items
    );
  }

  @Get('stats')
  @HttpCode(HttpStatus.OK)
  getRegistryStats() {
    return this.registryService.getRegistryStats();
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  getCertificationById(@Param('id') id: string) {
    return this.registryService.getCertificationById(id);
  }

  @Get('certificate/:certificateNumber')
  @HttpCode(HttpStatus.OK)
  getCertificationByCertificateNumber(
    @Param('certificateNumber') certificateNumber: string
  ) {
    return this.registryService.getCertificationByCertificateNumber(certificateNumber);
  }

  @Get('location/search')
  @HttpCode(HttpStatus.OK)
  getCertificationsByLocation(
    @Query('city') city?: string,
    @Query('state') state?: string,
    @Query('country') country?: string,
    @Query('limit', ParseIntPipe) limit?: number,
  ) {
    return this.registryService.getCertificationsByLocation(
      city,
      state,
      country,
      Math.min(limit || 50, 200) // Max 200 results
    );
  }

  // Auto-complete endpoints for search suggestions
  @Get('autocomplete/locations')
  @HttpCode(HttpStatus.OK)
  async getLocationSuggestions(
    @Query('q') query?: string,
    @Query('limit', ParseIntPipe) limit?: number,
  ) {
    if (!query || query.length < 2) {
      return { suggestions: [] };
    }

    const limitNum = Math.min(limit || 10, 50);

    // Search for cities and states
    const locations = await this.registryService.searchCertifications({
      location: query,
      sortBy: 'relevance',
    }, 1, limitNum);

    // Extract unique location combinations
    const uniqueLocations = new Map<string, { city: string; state: string; country: string; count: number }>();

    locations.certifications.forEach(cert => {
      const key = `${cert.property.city}, ${cert.property.state}`;
      if (!uniqueLocations.has(key)) {
        uniqueLocations.set(key, {
          city: cert.property.city,
          state: cert.property.state,
          country: cert.property.country,
          count: 1,
        });
      } else {
        uniqueLocations.get(key)!.count++;
      }
    });

    const suggestions = Array.from(uniqueLocations.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, limitNum)
      .map(loc => ({
        value: `${loc.city}, ${loc.state}`,
        city: loc.city,
        state: loc.state,
        country: loc.country,
        count: loc.count,
      }));

    return { suggestions };
  }

  @Get('autocomplete/property-types')
  @HttpCode(HttpStatus.OK)
  async getPropertyTypeSuggestions(
    @Query('q') query?: string,
    @Query('limit', ParseIntPipe) limit?: number,
  ) {
    const limitNum = Math.min(limit || 10, 50);

    // Get all property types and filter by query if provided
    const stats = await this.registryService.getRegistryStats();
    const propertyTypes = stats.certificationsByPropertyType
      .filter(pt => !query || pt.propertyType.toLowerCase().includes(query.toLowerCase()))
      .slice(0, limitNum)
      .map(pt => ({
        value: pt.propertyType,
        count: pt.count,
      }));

    return { suggestions: propertyTypes };
  }

  @Get('autocomplete/amenities')
  @HttpCode(HttpStatus.OK)
  async getAmenitySuggestions(
    @Query('q') query?: string,
    @Query('limit', ParseIntPipe) limit?: number,
  ) {
    // This would need to be implemented based on how amenities are stored
    // For now, return common amenities
    const commonAmenities = [
      'WiFi', 'Pool', 'Hot Tub', 'Gym', 'Parking', 'Air Conditioning',
      'Heating', 'Kitchen', 'Washer', 'Dryer', 'Dishwasher', 'TV',
      'Balcony', 'Garden', 'BBQ', 'Fireplace', 'Pet Friendly'
    ];

    const limitNum = Math.min(limit || 10, 50);
    const filteredAmenities = commonAmenities
      .filter(amenity => !query || amenity.toLowerCase().includes(query.toLowerCase()))
      .slice(0, limitNum)
      .map(amenity => ({
        value: amenity,
        count: Math.floor(Math.random() * 100) + 1, // Mock count
      }));

    return { suggestions: filteredAmenities };
  }

  // Export endpoints for SEO and integrations
  @Get('export/sitemap')
  @HttpCode(HttpStatus.OK)
  async getSitemapData() {
    // Return data suitable for sitemap generation
    const stats = await this.registryService.getRegistryStats();
    const featured = await this.registryService.getFeaturedCertifications(100);

    return {
      totalCertifications: stats.totalActiveCertifications,
      lastUpdated: new Date().toISOString(),
      certifications: featured.map(cert => ({
        id: cert.id,
        certificateNumber: cert.certificateNumber,
        location: `${cert.property.city}, ${cert.property.state}`,
        propertyType: cert.property.propertyType,
        lastModified: cert.issuedAt.toISOString(),
        url: `/property/${cert.id}`,
      })),
    };
  }

  @Get('export/csv')
  @HttpCode(HttpStatus.OK)
  async exportToCsv(
    @Query('location') location?: string,
    @Query('propertyType') propertyType?: string,
  ) {
    // This would generate and return CSV data
    // For now, return basic structure
    const results = await this.registryService.searchCertifications({
      location,
      propertyType,
    }, 1, 1000); // Large limit for export

    // Convert to CSV-like structure
    const csvData = results.certifications.map(cert => ({
      certificateNumber: cert.certificateNumber,
      hostName: cert.host.name,
      propertyName: cert.property.name,
      address: cert.property.address,
      city: cert.property.city,
      state: cert.property.state,
      zipCode: cert.property.zipCode,
      propertyType: cert.property.propertyType,
      guests: cert.property.numberOfGuests,
      bedrooms: cert.property.numberOfBedrooms,
      bathrooms: cert.property.numberOfBathrooms,
      issuedDate: cert.issuedAt.toISOString().split('T')[0],
      expiryDate: cert.expiresAt.toISOString().split('T')[0],
      verificationUrl: cert.verificationUrl,
    }));

    return {
      data: csvData,
      total: results.total,
      generatedAt: new Date().toISOString(),
    };
  }
}
