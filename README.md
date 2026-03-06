# Normalization Calculator

A TypeScript/Node.js application for calculating normalized scores from survey responses. Supports manual input, API JSON parsing, and CSV file uploads with per-subject breakdown by evaluator relationship.

## Features

- **Multiple Input Modes**: Manual entry, API JSON, or CSV file upload
- **Per-Subject Analysis**: Breakdown by evaluator relationship (Self, Peer, Manager, Reportee)
- **Configurable Normalization**: Support for 5-point, 10-point, or custom scales (1-100)
- **Section & Question Scores**: Detailed per-question scores with section averages
- **JSON Export**: Download results as JSON for further processing
- **Modern UI**: Clean, professional design with responsive layout

## Quick Start

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start development server (with watch mode)
npm run dev
```

The application will be available at **http://localhost:5173**

## Project Structure

```
normalization/
├── public/                 # Frontend assets
│   ├── index.html         # Main HTML with inline JavaScript
│   └── styles.css         # CSS styling
├── src/                   # TypeScript source
│   ├── types.ts           # Type definitions
│   ├── normalization.ts   # Core normalization logic
│   ├── service.ts         # Service layer (manual/API modes)
│   ├── csvParser.ts       # CSV parsing and per-subject analysis
│   ├── apiParser.ts       # Survey JSON API parser
│   ├── index.ts           # Module exports
│   └── ui.ts              # Legacy UI module (unused)
├── scripts/
│   └── serve.mjs          # Node.js HTTP server with API endpoints
├── tests/
│   └── normalization.test.ts  # Unit tests
├── dist/                  # Compiled JavaScript (generated)
├── package.json
├── tsconfig.json
└── README.md
```

## File Descriptions

### Frontend (`public/`)

| File | Description |
|------|-------------|
| `index.html` | Single-page application with inline JavaScript. Handles all UI interactions, tab switching, form validation, CSV upload, and results rendering. Uses `fetch()` to call backend API endpoints. |
| `styles.css` | Professional CSS styling with CSS custom properties for theming. Uses indigo accent colors, subtle shadows, and responsive layout. |

### Source (`src/`)

| File | Description |
|------|-------------|
| `types.ts` | TypeScript interfaces for surveys, questions, sections, responses, and normalized results. Core types: `SurveyModel`, `NormalizationSettings`, `NormalizedSurveyResult`, `SubjectResult`. |
| `normalization.ts` | Core normalization functions. `normalizeRating()` converts raw values to percentage and score. `normalizeSection()` and `normalizeSurvey()` aggregate results. |
| `service.ts` | High-level service functions. `normalizeFromManualConfig()` for manual mode, `normalizeFromApi()` for API JSON mode. |
| `csvParser.ts` | CSV file parsing. `parseResponsesCsv()` for aggregate mode, `parseResponsesCsvBySubject()` for per-subject breakdown. Detects rating columns by "(Out of N)" pattern. |
| `apiParser.ts` | Parses raw survey JSON from SurveySparrow API format into normalized `SurveyModel`. |
| `index.ts` | Re-exports all modules for external consumption. |

### Server (`scripts/`)

| File | Description |
|------|-------------|
| `serve.mjs` | Node.js HTTP server that serves static files and handles API endpoints. Dynamically imports compiled TypeScript modules from `dist/`. |

## API Endpoints

All endpoints accept `POST` requests with JSON body.

### `POST /api/normalize/manual`

Calculate normalized scores from manual configuration.

**Request:**
```json
{
  "config": {
    "name": "Survey Name",
    "normalizationSettings": {
      "normalizationType": "score",
      "normalizeToValue": 5,
      "scaleLength": 5,
      "startScaleFromZero": false,
      "roundOffScores": { "active": true, "value": 1 },
      "scoreBy": { "inPercentage": true, "inScore": true }
    },
    "sections": [
      {
        "id": "S1",
        "name": "Section 1",
        "questions": [
          { "id": "S1_Q1", "text": "Question 1" }
        ]
      }
    ]
  },
  "response": {
    "responses": [
      { "questionId": "S1_Q1", "value": 4 }
    ]
  }
}
```

**Response:**
```json
{
  "surveyId": "manual",
  "surveyName": "Survey Name",
  "sections": [...],
  "summary": {
    "overallAveragePercentage": 80,
    "overallAverageScore": 4
  }
}
```

### `POST /api/normalize/csv`

Aggregate all CSV responses into a single result.

**Request:**
```json
{
  "csvText": "Header1,Header2,...\nRow1,Row2,...",
  "normalizeToValue": 5,
  "roundingActive": true,
  "roundingDecimals": 1
}
```

### `POST /api/normalize/csv-by-subject`

Parse CSV with per-subject breakdown by evaluator relationship.

**Request:**
```json
{
  "csvText": "...",
  "normalizeToValue": 5,
  "scaleLength": 5,
  "startScaleFromZero": false,
  "roundingActive": true,
  "roundingDecimals": 1
}
```

**Response:**
```json
{
  "subjects": [
    {
      "subjectName": "John Doe",
      "subjectEmail": "john@example.com",
      "relationships": [
        {
          "relation": "Self",
          "evaluatorCount": 1,
          "sections": [...],
          "summary": { "overallAveragePercentage": 80, "overallAverageScore": 4 }
        },
        {
          "relation": "Peer",
          "evaluatorCount": 3,
          "sections": [...],
          "summary": {...}
        }
      ],
      "overallSections": [...],
      "overallSummary": { "overallAveragePercentage": 76, "overallAverageScore": 3.8 }
    }
  ],
  "scaleLength": 5,
  "totalResponseCount": 10
}
```

## CSV Format

The application expects CSV files with the following structure:

### Required Columns (for per-subject mode)
- `SubjectName` - Name of the person being evaluated
- `SubjectEmail` - Email of the subject (unique identifier)
- `Relation` - Evaluator relationship (Self, Peer, Manager, Reportee)
- `EvaluatorName` - Name of the person providing ratings (optional)

### Rating Columns
Rating columns are detected by headers containing `(Out of N)` pattern:
- `1.1 - Leadership quality (Out of 5)`
- `2.3 - Communication skills (Out of 5)`

The `N.M` prefix indicates Section N, Question M.

### Example CSV
```csv
SubjectName,SubjectEmail,Relation,EvaluatorName,1.1 - Leadership (Out of 5),1.2 - Teamwork (Out of 5)
John Doe,john@example.com,Self,John Doe,4,5
John Doe,john@example.com,Peer,Jane Smith,3,4
John Doe,john@example.com,Peer,Bob Wilson,4,4
Jane Smith,jane@example.com,Self,Jane Smith,5,4
```

## Normalization Logic

### Score Calculation

For a raw rating on a 1-N scale:

```
Percentage = (raw / scaleLength) × 100
Score = (raw / scaleLength) × normalizeToValue
```

**Example** (5-point scale, normalizeToValue=5):
- Raw rating: 3
- Percentage: (3/5) × 100 = **60%**
- Score: (3/5) × 5 = **3.0**

### Overall Subject Score

The overall score for a subject is calculated as the **mean of relationship averages**, giving equal weight to each relationship type regardless of evaluator count:

```
Overall = mean(Self avg, Peer avg, Manager avg, ...)
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to JavaScript |
| `npm run dev` | Start development server with TypeScript watch mode |
| `npm run test` | Run unit tests |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5173` | HTTP server port |

### Normalization Settings

| Setting | Type | Description |
|---------|------|-------------|
| `normalizeToValue` | number | Target scale for normalized scores (e.g., 5, 10) |
| `scaleLength` | number | Original rating scale length (e.g., 5 for 1-5 scale) |
| `startScaleFromZero` | boolean | Whether scale starts at 0 instead of 1 |
| `roundOffScores.active` | boolean | Enable/disable rounding |
| `roundOffScores.value` | number | Decimal places for rounding |

## Development

### Prerequisites
- Node.js 18+
- npm 9+

### Building
```bash
npm install
npm run build
```

### Running Tests
```bash
npm test
```

### Development Mode
```bash
npm run dev
```

This starts the server and watches for TypeScript changes.

## UI Features

### Input Modes

1. **Manual Mode**: Enter survey structure and ratings manually
2. **API Mode**: Paste raw survey JSON from SurveySparrow API
3. **CSV Upload**: Drag-and-drop or browse for CSV file

### Scale Selection

Choose normalization scale:
- **5 Point** (default)
- **10 Point**
- **Custom** (1-100)

### Output Modes (CSV)

- **Aggregate all responses**: Single combined result
- **Per-subject breakdown**: Individual results by subject and relationship

### Results

- Expandable subject cards showing overall scores
- Section-wise breakdown with per-question details
- "View by Relationship" expandable section for detailed breakdown
- Download JSON button for exporting results

## License

ISC
