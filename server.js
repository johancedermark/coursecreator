require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Initialize database
async function initDb() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS courses (
                id SERIAL PRIMARY KEY,
                topic VARCHAR(255) NOT NULL,
                data JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('Database initialized');
    } catch (error) {
        console.error('Database init error:', error.message);
        console.log('Running without database - using localStorage fallback');
    }
}

// Check if database is available
async function isDatabaseAvailable() {
    try {
        await pool.query('SELECT 1');
        return true;
    } catch {
        return false;
    }
}

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

// === DATABASE ENDPOINTS ===

// Get all saved courses
app.get('/api/courses', async (req, res) => {
    if (!await isDatabaseAvailable()) {
        return res.json({ courses: [], useLocalStorage: true });
    }

    try {
        const result = await pool.query(
            'SELECT id, topic, data, created_at, updated_at FROM courses ORDER BY updated_at DESC'
        );
        const courses = result.rows.map(row => ({
            id: row.id,
            ...row.data,
            savedAt: row.updated_at
        }));
        res.json({ courses, useLocalStorage: false });
    } catch (error) {
        console.error('Get courses error:', error);
        res.status(500).json({ error: 'Failed to get courses' });
    }
});

// Save a new course
app.post('/api/courses', async (req, res) => {
    if (!await isDatabaseAvailable()) {
        return res.json({ success: true, useLocalStorage: true });
    }

    const { course } = req.body;
    if (!course || !course.topic) {
        return res.status(400).json({ error: 'Course data required' });
    }

    try {
        // Check if course with same topic exists
        const existing = await pool.query(
            'SELECT id FROM courses WHERE topic = $1',
            [course.topic]
        );

        let result;
        if (existing.rows.length > 0) {
            // Update existing
            result = await pool.query(
                'UPDATE courses SET data = $1, updated_at = CURRENT_TIMESTAMP WHERE topic = $2 RETURNING id',
                [JSON.stringify(course), course.topic]
            );
        } else {
            // Insert new
            result = await pool.query(
                'INSERT INTO courses (topic, data) VALUES ($1, $2) RETURNING id',
                [course.topic, JSON.stringify(course)]
            );
        }

        res.json({ success: true, id: result.rows[0].id, useLocalStorage: false });
    } catch (error) {
        console.error('Save course error:', error);
        res.status(500).json({ error: 'Failed to save course' });
    }
});

// Delete a course
app.delete('/api/courses/:id', async (req, res) => {
    if (!await isDatabaseAvailable()) {
        return res.json({ success: true, useLocalStorage: true });
    }

    const { id } = req.params;

    try {
        await pool.query('DELETE FROM courses WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete course error:', error);
        res.status(500).json({ error: 'Failed to delete course' });
    }
});

// === COURSE GENERATION ENDPOINTS ===

// Generate course structure using Claude
app.post('/api/generate-course', async (req, res) => {
    const { topic } = req.body;

    if (!topic) {
        return res.status(400).json({ error: 'Topic is required' });
    }

    try {
        const message = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            messages: [{
                role: 'user',
                content: `Du är en expert på utbildningsdesign. Bryt ned ämnet "${topic}" i 8-12 nyckelkompetenser/skills som en person behöver behärska för att gå från nybörjare till avancerad nivå.

För varje kompetens, ge:
1. Ett kort namn (max 3 ord)
2. En kort beskrivning (1 mening)
3. 3 söktermer för YouTube som skulle hitta bra utbildningsvideor för denna kompetens (från nybörjare till avancerad)

Svara ENDAST med giltig JSON i detta format:
{
  "topic": "${topic}",
  "skills": [
    {
      "name": "Kompetensnamn",
      "description": "Kort beskrivning",
      "searchTerms": {
        "beginner": "sökterm för nybörjare",
        "intermediate": "sökterm för medel",
        "advanced": "sökterm för avancerad"
      }
    }
  ]
}`
            }]
        });

        const responseText = message.content[0].text;

        let courseStructure;
        try {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                courseStructure = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('No JSON found in response');
            }
        } catch (parseError) {
            console.error('JSON parse error:', parseError);
            return res.status(500).json({ error: 'Failed to parse AI response', raw: responseText });
        }

        res.json(courseStructure);
    } catch (error) {
        console.error('Claude API error:', error);
        res.status(500).json({ error: 'Failed to generate course structure' });
    }
});

// Search YouTube videos
app.post('/api/search-youtube', async (req, res) => {
    const { query, maxResults = 10 } = req.body;

    if (!query) {
        return res.status(400).json({ error: 'Query is required' });
    }

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'YouTube API key not configured' });
    }

    try {
        const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=${encodeURIComponent(query)}&maxResults=${maxResults}&order=relevance&relevanceLanguage=sv&key=${apiKey}`;

        const response = await fetch(searchUrl);
        const data = await response.json();

        if (data.error) {
            console.error('YouTube API error:', data.error);
            return res.status(500).json({ error: data.error.message });
        }

        const videos = data.items.map(item => ({
            id: item.id.videoId,
            title: item.snippet.title,
            description: item.snippet.description,
            thumbnail: item.snippet.thumbnails.medium.url,
            channelTitle: item.snippet.channelTitle
        }));

        res.json({ videos });
    } catch (error) {
        console.error('YouTube search error:', error);
        res.status(500).json({ error: 'Failed to search YouTube' });
    }
});

// Generate full course with videos
app.post('/api/generate-full-course', async (req, res) => {
    const { topic } = req.body;

    if (!topic) {
        return res.status(400).json({ error: 'Topic is required' });
    }

    try {
        const structureResponse = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            messages: [{
                role: 'user',
                content: `Du är en expert på utbildningsdesign. Bryt ned ämnet "${topic}" i 8-12 nyckelkompetenser/skills som en person behöver behärska för att gå från nybörjare till avancerad nivå.

För varje kompetens, ge:
1. Ett kort namn (max 3 ord)
2. En kort beskrivning (1 mening)
3. 10 specifika YouTube-söktermer sorterade från enklast/nybörjare (index 0) till mest avancerad (index 9)

Svara ENDAST med giltig JSON i detta format:
{
  "topic": "${topic}",
  "skills": [
    {
      "name": "Kompetensnamn",
      "description": "Kort beskrivning",
      "searchTerms": ["nybörjarterm1", "nybörjarterm2", "medelterm1", "medelterm2", "medelterm3", "medelterm4", "avanceradterm1", "avanceradterm2", "avanceradterm3", "expertterm1"]
    }
  ]
}`
            }]
        });

        const responseText = structureResponse.content[0].text;
        let courseStructure;

        try {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                courseStructure = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('No JSON found');
            }
        } catch (parseError) {
            return res.status(500).json({ error: 'Failed to parse course structure' });
        }

        const apiKey = process.env.YOUTUBE_API_KEY;
        if (!apiKey) {
            console.warn('⚠️ YOUTUBE_API_KEY is not set!');
            return res.json({ ...courseStructure, videos: null, message: 'No YouTube API key - returning structure only' });
        }

        console.log('📺 Starting YouTube video search...');
        console.log(`   API Key present: ${apiKey ? 'Yes (' + apiKey.substring(0, 10) + '...)' : 'No'}`);

        let totalSearches = 0;
        let successfulSearches = 0;
        let failedSearches = 0;
        let youtubeErrors = [];

        const skillsWithVideos = await Promise.all(
            courseStructure.skills.map(async (skill) => {
                const videos = [];

                for (const term of skill.searchTerms) {
                    totalSearches++;
                    try {
                        const searchQuery = `${term} ${topic} tutorial`;
                        const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=${encodeURIComponent(searchQuery)}&maxResults=1&order=relevance&key=${apiKey}`;

                        console.log(`   🔍 Searching: "${searchQuery}"`);

                        const response = await fetch(searchUrl);
                        const data = await response.json();

                        // Check for API errors
                        if (data.error) {
                            failedSearches++;
                            const errorInfo = {
                                term: term,
                                code: data.error.code,
                                message: data.error.message,
                                reason: data.error.errors?.[0]?.reason || 'unknown'
                            };
                            youtubeErrors.push(errorInfo);
                            console.error(`   ❌ YouTube API Error:`, JSON.stringify(errorInfo, null, 2));

                            // If quota exceeded, stop all searches
                            if (data.error.errors?.[0]?.reason === 'quotaExceeded') {
                                console.error('   🚫 QUOTA EXCEEDED - Stopping all YouTube searches');
                                break;
                            }
                            continue;
                        }

                        if (data.items && data.items.length > 0) {
                            successfulSearches++;
                            const item = data.items[0];
                            videos.push({
                                id: item.id.videoId,
                                title: item.snippet.title,
                                thumbnail: item.snippet.thumbnails.medium.url,
                                channelTitle: item.snippet.channelTitle,
                                searchTerm: term
                            });
                            console.log(`   ✅ Found: "${item.snippet.title.substring(0, 50)}..."`);
                        } else {
                            failedSearches++;
                            console.log(`   ⚠️ No results for: "${term}"`);
                        }
                    } catch (err) {
                        failedSearches++;
                        console.error(`   ❌ Network/fetch error for "${term}":`, err.message);
                        youtubeErrors.push({
                            term: term,
                            code: 'FETCH_ERROR',
                            message: err.message
                        });
                    }
                }

                return {
                    ...skill,
                    videos
                };
            })
        );

        // Summary logging
        console.log('\n📊 YouTube Search Summary:');
        console.log(`   Total searches: ${totalSearches}`);
        console.log(`   Successful: ${successfulSearches}`);
        console.log(`   Failed: ${failedSearches}`);
        if (youtubeErrors.length > 0) {
            console.log(`   Errors encountered:`);
            youtubeErrors.forEach(err => {
                console.log(`     - ${err.term}: ${err.reason || err.code} - ${err.message}`);
            });
        }

        res.json({
            topic: courseStructure.topic,
            skills: skillsWithVideos,
            generatedAt: new Date().toISOString(),
            _debug: {
                totalSearches,
                successfulSearches,
                failedSearches,
                errors: youtubeErrors.length > 0 ? youtubeErrors.slice(0, 5) : undefined // Only first 5 errors
            }
        });

    } catch (error) {
        console.error('Full course generation error:', error);
        res.status(500).json({ error: 'Failed to generate course' });
    }
});

// Health check endpoint for Render
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize database and start server
initDb().then(() => {
    app.listen(PORT, () => {
        console.log(`Course Creator running at http://localhost:${PORT}`);
    });
});
