import { Video, VideoStatus } from "../types/index.js";
import { VideoModel } from "../model/video.js";
import { cacheService } from "./cacheService.js";

export interface SearchFilters {
  status?: VideoStatus[];
  dateFrom?: Date;
  dateTo?: Date;
  minDuration?: number;
  maxDuration?: number;
  minFileSize?: number;
  maxFileSize?: number;
  tags?: string[];
}

export interface SearchOptions {
  page?: number;
  limit?: number;
  sortBy?: 'relevance' | 'date' | 'duration' | 'fileSize' | 'title';
  sortOrder?: 'asc' | 'desc';
}

export interface SearchResult {
  videos: Video[];
  totalCount: number;
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/**
 * Advanced Search Service for Video Content
 * Provides multiple search strategies with caching and optimization
 */
export class SearchService {
  
  /**
   * CURRENT: MongoDB Text Search with Regex Fallback
   * Basic search using MongoDB's text search capabilities
   */
  async basicSearch(
    query: string, 
    filters: SearchFilters = {}, 
    options: SearchOptions = {}
  ): Promise<SearchResult> {
    const { page = 1, limit = 20, sortBy = 'relevance', sortOrder = 'desc' } = options;
    const skip = (page - 1) * limit;

    try {
      // Build MongoDB query
      const searchConditions: any = {};
      
      // Text search
      if (query) {
        searchConditions.$or = [
          { title: { $regex: query, $options: "i" } },
          { description: { $regex: query, $options: "i" } },
          { filename: { $regex: query, $options: "i" } },
        ];
      }

      // Apply filters
      if (filters.status?.length) {
        searchConditions.status = { $in: filters.status };
      }

      if (filters.dateFrom || filters.dateTo) {
        searchConditions.createdAt = {};
        if (filters.dateFrom) searchConditions.createdAt.$gte = filters.dateFrom;
        if (filters.dateTo) searchConditions.createdAt.$lte = filters.dateTo;
      }

      if (filters.minDuration || filters.maxDuration) {
        searchConditions.duration = {};
        if (filters.minDuration) searchConditions.duration.$gte = filters.minDuration;
        if (filters.maxDuration) searchConditions.duration.$lte = filters.maxDuration;
      }

      if (filters.minFileSize || filters.maxFileSize) {
        searchConditions.fileSize = {};
        if (filters.minFileSize) searchConditions.fileSize.$gte = filters.minFileSize;
        if (filters.maxFileSize) searchConditions.fileSize.$lte = filters.maxFileSize;
      }

      // Build sort options
      let sortOptions: any = {};
      switch (sortBy) {
        case 'date':
          sortOptions.createdAt = sortOrder === 'asc' ? 1 : -1;
          break;
        case 'duration':
          sortOptions.duration = sortOrder === 'asc' ? 1 : -1;
          break;
        case 'fileSize':
          sortOptions.fileSize = sortOrder === 'asc' ? 1 : -1;
          break;
        case 'title':
          sortOptions.title = sortOrder === 'asc' ? 1 : -1;
          break;
        default: // relevance
          sortOptions.createdAt = -1; // Most recent first for relevance
      }

      // Execute search
      const [videos, totalCount] = await Promise.all([
        VideoModel.find(searchConditions)
          .sort(sortOptions)
          .skip(skip)
          .limit(limit)
          .lean(),
        VideoModel.countDocuments(searchConditions)
      ]);

      const totalPages = Math.ceil(totalCount / limit);

      return {
        videos: videos.map(video => ({
          id: video._id.toString(),
          title: video.title,
          description: video.description || '',
          filename: video.filename,
          fileSize: video.fileSize || 0,
          duration: video.duration || 0,
          status: video.status,
          thumbnailUrl: video.thumbnailUrl || '',
          videoUrl: video.videoUrl || '',
          manifestUrl: video.manifestUrl || '',
          createdAt: video.createdAt.toISOString(),
          updatedAt: video.updatedAt.toISOString(),
        })),
        totalCount,
        page,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      };

    } catch (error) {
      console.error("Error in basic search:", error);
      throw new Error("Search failed");
    }
  }

  /**
   * Auto-suggest search terms based on existing video titles
   */
  async getSearchSuggestions(partial: string, limit = 5): Promise<string[]> {
    try {
      const cacheKey = `search:suggestions:${partial.toLowerCase()}`;
      const cached = await cacheService.getCachedSearchResults(cacheKey);
      
      if (cached) {
        return cached as any;
      }

      const suggestions = await VideoModel.aggregate([
        {
          $match: {
            title: { $regex: partial, $options: "i" },
            status: VideoStatus.READY
          }
        },
        {
          $project: { title: 1 }
        },
        {
          $group: {
            _id: "$title",
            count: { $sum: 1 }
          }
        },
        {
          $sort: { count: -1 }
        },
        {
          $limit: limit
        }
      ]);

      const result = suggestions.map(s => s._id);
      
      // Cache suggestions for 1 hour
      await cacheService.cacheSearchResults(cacheKey, result as any);
      
      return result;
    } catch (error) {
      console.error("Error getting search suggestions:", error);
      return [];
    }
  }
}

export const searchService = new SearchService();

// ================================
// 🚀 ADVANCED SEARCH ALTERNATIVES
// ================================

export const ADVANCED_SEARCH_SOLUTIONS = {
  
  /**
   * 1. ELASTICSEARCH INTEGRATION
   * Best for: Complex search, faceted search, real-time suggestions
   * Cost: ~$50-200/month for managed service
   */
  ELASTICSEARCH: {
    description: "Full-text search engine with advanced features",
    pros: [
      "Lightning-fast full-text search",
      "Advanced filtering and faceting",
      "Real-time search suggestions",
      "Analytics and search insights", 
      "Fuzzy matching and typo tolerance",
      "Geo-search capabilities",
      "Machine learning features"
    ],
    cons: [
      "Additional infrastructure cost",
      "Complex setup and maintenance",
      "Learning curve for optimization",
      "Data synchronization needed"
    ],
    implementation: `
// Example Elasticsearch integration
import { Client } from '@elastic/elasticsearch';

const esClient = new Client({ 
  cloud: { id: 'your-elastic-cloud-id' },
  auth: { apiKey: 'your-api-key' }
});

// Index video on creation/update
async function indexVideo(video: Video) {
  await esClient.index({
    index: 'videos',
    id: video.id,
    body: {
      title: video.title,
      description: video.description,
      tags: video.tags,
      duration: video.duration,
      fileSize: video.fileSize,
      createdAt: video.createdAt,
      status: video.status,
      // Add searchable metadata
      searchText: \`\${video.title} \${video.description}\`,
    }
  });
}

// Advanced search
async function searchVideos(query: string, filters: any) {
  const result = await esClient.search({
    index: 'videos',
    body: {
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query: query,
                fields: ['title^3', 'description^2', 'searchText'],
                fuzziness: 'AUTO'
              }
            }
          ],
          filter: [
            { term: { status: 'READY' } },
            { range: { duration: { gte: filters.minDuration } } }
          ]
        }
      },
      aggs: {
        status_counts: { terms: { field: 'status' } },
        duration_ranges: { 
          range: { 
            field: 'duration',
            ranges: [
              { to: 300 }, // < 5 minutes
              { from: 300, to: 1800 }, // 5-30 minutes
              { from: 1800 } // > 30 minutes
            ]
          }
        }
      }
    }
  });
  
  return result.body;
}`,
    cost: "$50-200/month",
    complexity: "High"
  },

  /**
   * 2. AMAZON OPENSEARCH (MANAGED ELASTICSEARCH)
   * Best for: AWS-native integration, managed service
   * Cost: ~$30-150/month for small-medium workloads
   */
  OPENSEARCH: {
    description: "AWS managed search service (Elasticsearch fork)",
    pros: [
      "Fully managed by AWS",
      "Seamless AWS integration", 
      "Auto-scaling capabilities",
      "Built-in security features",
      "VPC integration",
      "Cost-effective for AWS workloads"
    ],
    cons: [
      "AWS vendor lock-in",
      "Limited compared to full Elasticsearch",
      "Still requires search expertise",
      "Cold start issues"
    ],
    implementation: `
// Amazon OpenSearch integration with AWS SDK v3
import { OpenSearchClient, SearchCommand } from '@aws-sdk/client-opensearch';

const opensearchClient = new OpenSearchClient({
  region: 'us-east-1',
  endpoint: 'https://your-domain.us-east-1.es.amazonaws.com'
});

// Search with OpenSearch
async function opensearchQuery(query: string) {
  const searchParams = {
    index: 'videos',
    body: {
      query: {
        multi_match: {
          query: query,
          fields: ['title', 'description'],
          type: 'best_fields',
          fuzziness: 'AUTO'
        }
      },
      highlight: {
        fields: {
          title: {},
          description: {}
        }
      }
    }
  };
  
  const command = new SearchCommand(searchParams);
  return await opensearchClient.send(command);
}`,
    cost: "$30-150/month",
    complexity: "Medium-High"
  },

  /**
   * 3. MONGODB ATLAS SEARCH
   * Best for: MongoDB users, simple integration
   * Cost: ~$20-100/month additional to Atlas
   */
  ATLAS_SEARCH: {
    description: "Native MongoDB full-text search built on Lucene",
    pros: [
      "Native MongoDB integration",
      "No additional infrastructure",
      "Lucene-powered search",
      "Auto-complete support",
      "Faceted search",
      "Simple setup for MongoDB users"
    ],
    cons: [
      "Requires MongoDB Atlas (cloud only)",
      "Limited compared to Elasticsearch",
      "Additional Atlas costs",
      "Less flexible than standalone solutions"
    ],
    implementation: `
// MongoDB Atlas Search indexes
// Create search index via Atlas UI or CLI:
{
  "mappings": {
    "dynamic": false,
    "fields": {
      "title": {
        "type": "string",
        "analyzer": "standard"
      },
      "description": {
        "type": "string", 
        "analyzer": "standard"
      },
      "status": {
        "type": "string"
      }
    }
  }
}

// Search query using aggregation pipeline
async function atlasSearch(query: string) {
  const pipeline = [
    {
      $search: {
        index: "video_search",
        text: {
          query: query,
          path: ["title", "description"],
          fuzzy: {
            maxEdits: 2
          }
        }
      }
    },
    {
      $addFields: {
        score: { $meta: "searchScore" }
      }
    },
    {
      $match: {
        status: "READY"
      }
    },
    {
      $sort: {
        score: -1
      }
    }
  ];
  
  return await VideoModel.aggregate(pipeline);
}`,
    cost: "$20-100/month",
    complexity: "Medium"
  },

  /**
   * 4. TYPESENSE
   * Best for: Real-time search, auto-complete, affordable
   * Cost: ~$15-80/month for managed, or self-hosted
   */
  TYPESENSE: {
    description: "Open-source search engine optimized for speed",
    pros: [
      "Extremely fast search responses (<10ms)",
      "Built-in typo tolerance",
      "Real-time indexing",
      "Simple REST API",
      "Affordable pricing",
      "Great auto-complete",
      "Easy to deploy and maintain"
    ],
    cons: [
      "Smaller community than Elasticsearch",
      "Fewer advanced features",
      "Less ecosystem integration",
      "Newer technology"
    ],
    implementation: `
// Typesense integration
import Typesense from 'typesense';

const client = new Typesense.Client({
  nodes: [{
    host: 'your-typesense-cluster.com',
    port: 443,
    protocol: 'https'
  }],
  apiKey: 'your-api-key'
});

// Create videos collection schema
const videosSchema = {
  name: 'videos',
  fields: [
    { name: 'title', type: 'string' },
    { name: 'description', type: 'string' },
    { name: 'duration', type: 'int32' },
    { name: 'fileSize', type: 'int64' },
    { name: 'createdAt', type: 'int64' },
    { name: 'status', type: 'string', facet: true }
  ]
};

// Search with auto-complete
async function typesenseSearch(query: string) {
  return await client.collections('videos').documents().search({
    q: query,
    query_by: 'title,description',
    filter_by: 'status:READY',
    facet_by: 'status',
    max_facet_values: 10,
    sort_by: 'createdAt:desc'
  });
}`,
    cost: "$15-80/month",
    complexity: "Low-Medium"
  },

  /**
   * 5. ALGOLIA
   * Best for: Frontend search experience, instant search
   * Cost: ~$50-300/month based on operations
   */
  ALGOLIA: {
    description: "Search-as-a-service with excellent UX features",
    pros: [
      "Instant search results",
      "Excellent frontend SDKs",
      "Analytics and insights",
      "A/B testing for search",
      "Geo-search capabilities", 
      "Great documentation",
      "Managed service - zero ops"
    ],
    cons: [
      "Can be expensive at scale",
      "Vendor lock-in",
      "Limited customization",
      "Usage-based pricing"
    ],
    implementation: `
// Algolia integration
import algoliasearch from 'algoliasearch';

const client = algoliasearch('YourApplicationID', 'YourAdminAPIKey');
const index = client.initIndex('videos');

// Add video to Algolia index
async function indexVideoInAlgolia(video: Video) {
  await index.saveObject({
    objectID: video.id,
    title: video.title,
    description: video.description,
    duration: video.duration,
    status: video.status,
    createdAt: Math.floor(new Date(video.createdAt).getTime() / 1000),
    _tags: [video.status, 'video']
  });
}

// Search with faceting
async function algoliaSearch(query: string, filters: any = {}) {
  return await index.search(query, {
    filters: 'status:READY',
    facets: ['status', 'duration'],
    attributesToHighlight: ['title', 'description'],
    hitsPerPage: 20
  });
}`,
    cost: "$50-300/month",
    complexity: "Low"
  }
};

/**
 * RECOMMENDATION FOR YOUR VIDEO STREAMING PLATFORM
 */
export const RECOMMENDED_SOLUTION = {
  immediate: "MongoDB Atlas Search",
  reasoning: [
    "You're already using MongoDB - seamless integration",
    "No additional infrastructure to manage", 
    "Cost-effective for current scale",
    "Quick to implement and test"
  ],
  longTerm: "Typesense or Elasticsearch",
  reasoning_longTerm: [
    "Better performance at scale",
    "More advanced search features",
    "Real-time search capabilities",
    "Better user experience"
  ]
};