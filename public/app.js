// DOM Elements
const topicInput = document.getElementById('topic-input');
const generateBtn = document.getElementById('generate-btn');
const loadingDiv = document.getElementById('loading');
const inputSection = document.getElementById('input-section');
const courseSection = document.getElementById('course-section');
const courseTitle = document.getElementById('course-title');
const skillsContainer = document.getElementById('skills-container');
const saveCourseBtn = document.getElementById('save-course-btn');
const exportJsonBtn = document.getElementById('export-json-btn');
const exportTrainstationBtn = document.getElementById('export-trainstation-btn');
const newCourseBtn = document.getElementById('new-course-btn');
const videoModal = document.getElementById('video-modal');
const videoContainer = document.getElementById('video-container');
const videoTitleEl = document.getElementById('video-title');
const closeBtn = document.querySelector('.close-btn');
const savedCoursesList = document.getElementById('saved-courses-list');
const importJsonBtn = document.getElementById('import-json-btn');
const importFile = document.getElementById('import-file');

// Current course data
let currentCourse = null;
let useLocalStorage = false; // Will be set based on server response

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadSavedCourses();
});

// Event Listeners
generateBtn.addEventListener('click', generateCourse);
topicInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') generateCourse();
});
saveCourseBtn.addEventListener('click', saveCourse);
exportJsonBtn.addEventListener('click', exportToJson);
exportTrainstationBtn.addEventListener('click', exportToTrainstation);
newCourseBtn.addEventListener('click', resetToInput);
closeBtn.addEventListener('click', closeModal);
videoModal.addEventListener('click', (e) => {
    if (e.target === videoModal) closeModal();
});
importJsonBtn.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', handleImport);

// Generate course
async function generateCourse() {
    const topic = topicInput.value.trim();
    if (!topic) {
        alert('Ange ett ämne du vill lära dig');
        return;
    }

    generateBtn.disabled = true;
    loadingDiv.classList.remove('hidden');

    try {
        const response = await fetch('/api/generate-full-course', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topic })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to generate course');
        }

        currentCourse = await response.json();

        // Check for debug info and display warnings
        if (currentCourse._debug) {
            const debug = currentCourse._debug;
            console.log('📊 Course Generation Debug:', debug);

            if (debug.failedSearches > 0 || debug.errors) {
                let warningMsg = `Varning: ${debug.successfulSearches}/${debug.totalSearches} videosökningar lyckades.`;

                if (debug.errors && debug.errors.length > 0) {
                    const firstError = debug.errors[0];
                    if (firstError.reason === 'quotaExceeded') {
                        warningMsg += '\n\n⚠️ YouTube API-kvot överskiden! Vänta till imorgon eller använd en annan API-nyckel.';
                    } else if (firstError.code === 403) {
                        warningMsg += `\n\n⚠️ API-åtkomst nekad: ${firstError.message}`;
                    } else if (firstError.code === 400) {
                        warningMsg += `\n\n⚠️ Ogiltig förfrågan: ${firstError.message}`;
                    } else {
                        warningMsg += `\n\nFel: ${firstError.message || 'Okänt fel'}`;
                    }
                }

                console.warn(warningMsg);
                if (debug.successfulSearches === 0) {
                    alert(warningMsg);
                }
            }
        }

        displayCourse(currentCourse);

    } catch (error) {
        console.error('Error:', error);
        alert('Kunde inte generera kursen: ' + error.message);
    } finally {
        generateBtn.disabled = false;
        loadingDiv.classList.add('hidden');
    }
}

// Display course in Netflix-style grid
function displayCourse(course) {
    courseTitle.textContent = `Kurs: ${course.topic}`;
    skillsContainer.innerHTML = '';

    course.skills.forEach((skill, skillIndex) => {
        const skillRow = document.createElement('div');
        skillRow.className = 'skill-row';

        const skillHeader = document.createElement('div');
        skillHeader.className = 'skill-header';
        skillHeader.innerHTML = `
            <h3>${skill.name}</h3>
            <p>${skill.description}</p>
        `;

        const videosScroll = document.createElement('div');
        videosScroll.className = 'videos-scroll';

        if (skill.videos && skill.videos.length > 0) {
            skill.videos.forEach((video, videoIndex) => {
                const difficulty = getDifficultyLevel(videoIndex, skill.videos.length);
                const videoCard = createVideoCard(video, difficulty);
                videosScroll.appendChild(videoCard);
            });
        } else {
            videosScroll.innerHTML = '<p style="color: #888; padding: 20px;">Inga videos hittades för denna kompetens</p>';
        }

        skillRow.appendChild(skillHeader);
        skillRow.appendChild(videosScroll);
        skillsContainer.appendChild(skillRow);
    });

    inputSection.classList.add('hidden');
    courseSection.classList.remove('hidden');
}

// Create video card element
function createVideoCard(video, difficulty) {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.onclick = () => playVideo(video);

    const difficultyClass = `difficulty-${difficulty.toLowerCase()}`;
    const difficultyLabel = {
        'beginner': 'Nybörjare',
        'intermediate': 'Medel',
        'advanced': 'Avancerad'
    }[difficulty.toLowerCase()];

    card.innerHTML = `
        <img src="${video.thumbnail}" alt="${video.title}" loading="lazy">
        <div class="video-info">
            <div class="video-title">${video.title}</div>
            <div class="video-channel">${video.channelTitle}</div>
            <span class="difficulty-badge ${difficultyClass}">${difficultyLabel}</span>
        </div>
    `;

    return card;
}

// Get difficulty level based on position
function getDifficultyLevel(index, total) {
    const position = index / total;
    if (position < 0.33) return 'beginner';
    if (position < 0.66) return 'intermediate';
    return 'advanced';
}

// Play video in modal
function playVideo(video) {
    videoContainer.innerHTML = `
        <iframe
            src="https://www.youtube.com/embed/${video.id}?autoplay=1"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen>
        </iframe>
    `;
    videoTitleEl.textContent = video.title;
    videoModal.classList.remove('hidden');
}

// Close modal
function closeModal() {
    videoModal.classList.add('hidden');
    videoContainer.innerHTML = '';
}

// === SAVED COURSES FUNCTIONALITY ===

// LocalStorage fallback functions
function getLocalCourses() {
    const saved = localStorage.getItem('savedCourses');
    return saved ? JSON.parse(saved) : [];
}

function setLocalCourses(courses) {
    localStorage.setItem('savedCourses', JSON.stringify(courses));
}

// Load saved courses from server or localStorage
async function loadSavedCourses() {
    try {
        const response = await fetch('/api/courses');
        const data = await response.json();

        useLocalStorage = data.useLocalStorage;

        if (useLocalStorage) {
            displaySavedCourses(getLocalCourses());
        } else {
            displaySavedCourses(data.courses);
        }
    } catch (error) {
        console.error('Failed to load courses:', error);
        useLocalStorage = true;
        displaySavedCourses(getLocalCourses());
    }
}

// Save current course
async function saveCourse() {
    if (!currentCourse) return;

    try {
        if (useLocalStorage) {
            // Save to localStorage
            const courses = getLocalCourses();
            const existingIndex = courses.findIndex(c => c.topic === currentCourse.topic);

            if (existingIndex >= 0) {
                if (confirm(`En kurs med namnet "${currentCourse.topic}" finns redan. Vill du ersätta den?`)) {
                    courses[existingIndex] = { ...currentCourse, savedAt: new Date().toISOString() };
                } else {
                    return;
                }
            } else {
                courses.push({ ...currentCourse, savedAt: new Date().toISOString() });
            }

            setLocalCourses(courses);
            alert(`Kursen "${currentCourse.topic}" har sparats lokalt!`);
            displaySavedCourses(courses);
        } else {
            // Save to server database
            const response = await fetch('/api/courses', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ course: currentCourse })
            });

            const result = await response.json();

            if (result.useLocalStorage) {
                // Fallback to localStorage
                useLocalStorage = true;
                return saveCourse();
            }

            alert(`Kursen "${currentCourse.topic}" har sparats i databasen!`);
            loadSavedCourses();
        }
    } catch (error) {
        console.error('Save error:', error);
        alert('Kunde inte spara kursen');
    }
}

// Display saved courses list
function displaySavedCourses(courses) {
    if (!courses || courses.length === 0) {
        savedCoursesList.innerHTML = '<p class="no-courses-message">Inga sparade kurser än. Skapa din första kurs ovan!</p>';
        return;
    }

    savedCoursesList.innerHTML = '';

    courses.forEach((course, index) => {
        const card = document.createElement('div');
        card.className = 'saved-course-card';

        const savedDate = new Date(course.savedAt || course.generatedAt);
        const dateStr = savedDate.toLocaleDateString('sv-SE');

        const videoCount = course.skills ? course.skills.reduce((sum, skill) => sum + (skill.videos?.length || 0), 0) : 0;
        const skillCount = course.skills ? course.skills.length : 0;

        // Use database ID if available, otherwise use index
        const courseId = course.id || index;

        card.innerHTML = `
            <h4>${course.topic}</h4>
            <p>Sparad: ${dateStr}</p>
            <span class="skill-count">${skillCount} kompetenser, ${videoCount} videos</span>
            <button class="delete-btn" onclick="event.stopPropagation(); deleteCourse('${courseId}', ${index})">×</button>
        `;

        card.onclick = () => loadCourse(course);
        savedCoursesList.appendChild(card);
    });
}

// Load a saved course
function loadCourse(course) {
    currentCourse = course;
    displayCourse(currentCourse);
}

// Delete a saved course
async function deleteCourse(id, index) {
    if (!confirm('Är du säker på att du vill ta bort denna kurs?')) return;

    try {
        if (useLocalStorage) {
            const courses = getLocalCourses();
            courses.splice(index, 1);
            setLocalCourses(courses);
            displaySavedCourses(courses);
        } else {
            await fetch(`/api/courses/${id}`, { method: 'DELETE' });
            loadSavedCourses();
        }
    } catch (error) {
        console.error('Delete error:', error);
        alert('Kunde inte ta bort kursen');
    }
}

// Handle JSON import
async function handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const course = JSON.parse(e.target.result);

            if (!course.topic || !course.skills || !Array.isArray(course.skills)) {
                throw new Error('Ogiltig kursstruktur');
            }

            course.savedAt = new Date().toISOString();

            if (useLocalStorage) {
                const courses = getLocalCourses();
                courses.push(course);
                setLocalCourses(courses);
                displaySavedCourses(courses);
            } else {
                await fetch('/api/courses', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ course })
                });
                loadSavedCourses();
            }

            alert(`Kursen "${course.topic}" har importerats!`);

        } catch (error) {
            alert('Kunde inte importera filen: ' + error.message);
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

// Export to JSON
function exportToJson() {
    if (!currentCourse) return;

    const dataStr = JSON.stringify(currentCourse, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentCourse.topic.replace(/\s+/g, '_')}_course.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Generate UUID v4
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Get difficulty level string for Trainstation
function getTrainstationLevel(index, total) {
    const position = index / total;
    if (position < 0.33) return 'beginner';
    if (position < 0.66) return 'intermediate';
    return 'advanced';
}

// Export to Trainstation JSON format
function exportToTrainstation() {
    if (!currentCourse) return;

    const entities = [];

    // Create root entity for the course
    const rootId = generateUUID();
    const sectionIds = [];

    // Process each skill as a section
    currentCourse.skills.forEach((skill) => {
        const sectionId = generateUUID();
        sectionIds.push(sectionId);

        const videoIds = [];

        // Process each video
        if (skill.videos && skill.videos.length > 0) {
            skill.videos.forEach((video, videoIndex) => {
                const videoId = generateUUID();
                videoIds.push(videoId);

                // Create video entity
                const videoEntity = {
                    id: videoId,
                    type: 'video',
                    status: 'public',
                    labels: [currentCourse.topic, skill.name],
                    children: [],
                    attributes: {
                        title: video.title,
                        description: video.searchTerm || skill.description,
                        url: `https://www.youtube.com/watch?v=${video.id}`,
                        level: getTrainstationLevel(videoIndex, skill.videos.length),
                        thumbnail: video.thumbnail
                    }
                };
                entities.push(videoEntity);
            });
        }

        // Create section entity for the skill
        const sectionEntity = {
            id: sectionId,
            type: 'section',
            status: 'public',
            labels: [currentCourse.topic],
            children: videoIds,
            attributes: {
                title: skill.name,
                description: skill.description
            }
        };
        entities.push(sectionEntity);
    });

    // Create root entity
    const rootEntity = {
        id: rootId,
        type: 'root',
        status: 'public',
        labels: [],
        children: sectionIds,
        attributes: {
            title: currentCourse.topic,
            description: `AI-genererad kurs om ${currentCourse.topic}`
        }
    };
    entities.push(rootEntity);

    // Create the export object
    const trainstationExport = {
        root: rootId,
        entities: entities,
        exportedAt: new Date().toISOString(),
        source: 'CourseCreator'
    };

    // Download the file
    const dataStr = JSON.stringify(trainstationExport, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentCourse.topic.replace(/\s+/g, '_')}_trainstation.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    alert(`Trainstation JSON exporterad! Filen innehåller ${entities.length} entities.`);
}

// Reset to input view
function resetToInput() {
    courseSection.classList.add('hidden');
    inputSection.classList.remove('hidden');
    topicInput.value = '';
    currentCourse = null;
    loadSavedCourses();
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
});
