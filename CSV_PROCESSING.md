# CSV Processing - Technical Documentation

This document explains how CSV files are processed end-to-end, including the data flow, calculation logic, and internal architecture.

## Table of Contents

1. [Overview](#overview)
2. [Data Flow Diagram](#data-flow-diagram)
3. [CSV File Structure](#csv-file-structure)
4. [Processing Pipeline](#processing-pipeline)
5. [Normalization Calculations](#normalization-calculations)
6. [Data Structures](#data-structures)
7. [API Flow](#api-flow)
8. [Example Walkthrough](#example-walkthrough)

---

## Overview

The CSV processing system transforms raw survey response data into normalized scores with per-subject, per-relationship breakdowns. It supports 360-degree feedback surveys where multiple evaluators rate subjects across various competencies.

```
┌─────────────┐    ┌──────────────┐    ┌───────────────┐    ┌─────────────┐
│  CSV File   │───▶│  Parse CSV   │───▶│  Normalize    │───▶│  JSON       │
│  (Input)    │    │  & Group     │    │  Scores       │    │  (Output)   │
└─────────────┘    └──────────────┘    └───────────────┘    └─────────────┘
```

---

## Data Flow Diagram

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (index.html)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │ File Input   │───▶│ FileReader   │───▶│ csvText      │                  │
│  │ (drag/drop)  │    │ API          │    │ (string)     │                  │
│  └──────────────┘    └──────────────┘    └──────┬───────┘                  │
│                                                  │                          │
│  ┌──────────────┐                               │                          │
│  │ Scale Select │──────────────────────────────┐│                          │
│  │ (5/10/custom)│                              ││                          │
│  └──────────────┘                              ││                          │
│                                                 ▼▼                          │
│                                    ┌──────────────────────┐                │
│                                    │  fetch() POST        │                │
│                                    │  /api/normalize/     │                │
│                                    │  csv-by-subject      │                │
│                                    └──────────┬───────────┘                │
│                                               │                             │
└───────────────────────────────────────────────┼─────────────────────────────┘
                                                │
                                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND (serve.mjs)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────┐     ┌─────────────────────────────────────────┐   │
│  │ Parse JSON Body     │────▶│ Extract: csvText, normalizeToValue,     │   │
│  │                     │     │ scaleLength, roundingActive, decimals   │   │
│  └─────────────────────┘     └───────────────────┬─────────────────────┘   │
│                                                  │                          │
│                                                  ▼                          │
│                              ┌───────────────────────────────┐             │
│                              │ csvParserModule.              │             │
│                              │ parseResponsesCsvBySubject()  │             │
│                              └───────────────────────────────┘             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                                │
                                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CSV PARSER (csvParser.ts)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 1: Parse CSV Lines                                              │   │
│  │ ─────────────────────────────────────────────────────────────────── │   │
│  │ • Split by newlines                                                  │   │
│  │ • Parse each line respecting CSV quoting rules                       │   │
│  │ • Extract headers from first row                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                      │
│                                      ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 2: Identify Columns                                             │   │
│  │ ─────────────────────────────────────────────────────────────────── │   │
│  │ • Meta columns: SubjectName, SubjectEmail, Relation, EvaluatorName  │   │
│  │ • Rating columns: Match "(Out of N)" pattern                         │   │
│  │ • Extract section/question numbers from "N.M - ..." prefix          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                      │
│                                      ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 3: Build Section Structure                                      │   │
│  │ ─────────────────────────────────────────────────────────────────── │   │
│  │ • Group questions by section number                                  │   │
│  │ • Generate section IDs (S1, S2, ...)                                 │   │
│  │ • Generate question IDs (S1_Q1, S1_Q2, ...)                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                      │
│                                      ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 4: Parse Data Rows                                              │   │
│  │ ─────────────────────────────────────────────────────────────────── │   │
│  │ • For each row, extract:                                             │   │
│  │   - Subject info (name, email)                                       │   │
│  │   - Relation type (Self, Peer, Manager, Reportee)                   │   │
│  │   - All rating values mapped to question IDs                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                      │
│                                      ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 5: Group by Subject                                             │   │
│  │ ─────────────────────────────────────────────────────────────────── │   │
│  │ • Create map: SubjectKey → { name, email, rowsByRelation }          │   │
│  │ • SubjectKey = email (if exists) or name                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                      │
│                                      ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 6: Group by Relationship (within each Subject)                  │   │
│  │ ─────────────────────────────────────────────────────────────────── │   │
│  │ • Create map: Relation → [RowData, RowData, ...]                    │   │
│  │ • Each RowData contains one evaluator's ratings                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                      │
│                                      ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 7: Calculate Per-Relationship Scores                           │   │
│  │ ─────────────────────────────────────────────────────────────────── │   │
│  │ For each relationship:                                               │   │
│  │ • Average raw ratings per question across all evaluators            │   │
│  │ • Normalize each question average → percentage + score              │   │
│  │ • Calculate section averages                                         │   │
│  │ • Calculate relationship overall average                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                      │
│                                      ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 8: Calculate Subject Overall Scores                            │   │
│  │ ─────────────────────────────────────────────────────────────────── │   │
│  │ • For each question: mean of per-relationship averages              │   │
│  │ • Compute overallSections from question averages                    │   │
│  │ • Overall subject score = mean of relationship overall scores       │   │
│  │   (equal weight per relationship, not per evaluator)                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                                │
                                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              OUTPUT STRUCTURE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ParsedCsvBySubjectResult {                                                 │
│    subjects: [                                                              │
│      {                                                                      │
│        subjectName: "John Doe",                                             │
│        subjectEmail: "john@example.com",                                    │
│        relationships: [                                                     │
│          { relation: "Self", evaluatorCount: 1, sections: [...] },         │
│          { relation: "Peer", evaluatorCount: 3, sections: [...] }          │
│        ],                                                                   │
│        overallSections: [...],                                              │
│        overallSummary: { overallAveragePercentage, overallAverageScore }   │
│      }                                                                      │
│    ],                                                                       │
│    scaleLength: 5,                                                          │
│    totalResponseCount: 10,                                                  │
│    sections: [...]                                                          │
│  }                                                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## CSV File Structure

### Required Columns

| Column | Required | Description |
|--------|----------|-------------|
| `SubjectName` | Yes* | Name of the person being evaluated |
| `SubjectEmail` | Yes* | Email of the subject (used as unique identifier) |
| `Relation` | Yes | Evaluator's relationship to subject: Self, Peer, Manager, Reportee |
| `EvaluatorName` | No | Name of the person providing the rating |

*At least one of SubjectName or SubjectEmail is required.

### Rating Columns

Rating columns are auto-detected by matching this pattern in the header:

```
Pattern: /(?:\()?Out of (\d+)(?:\))?/i
Examples:
  "1.1 - Leadership quality (Out of 5)"
  "2.3 Communication skills Out of 5"
  "Question text (Out of 10)"
```

The `N.M` prefix (e.g., `1.1`, `2.3`) is parsed to determine:
- **N** = Section number
- **M** = Question number within section

### Example CSV

```csv
SubjectName,SubjectEmail,Relation,EvaluatorName,1.1 - Leadership (Out of 5),1.2 - Teamwork (Out of 5),2.1 - Communication (Out of 5)
John Doe,john@example.com,Self,John Doe,4,5,4
John Doe,john@example.com,Peer,Jane Smith,3,4,3
John Doe,john@example.com,Peer,Bob Wilson,4,4,4
John Doe,john@example.com,Manager,Alice Brown,4,5,5
Jane Smith,jane@example.com,Self,Jane Smith,5,4,4
Jane Smith,jane@example.com,Peer,John Doe,4,4,3
```

---

## Processing Pipeline

### Step-by-Step Breakdown

```
INPUT CSV
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ 1. LINE PARSING                                          │
│    parseCsvLine() handles quoted values, commas, tabs   │
│    Output: string[][]                                    │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ 2. COLUMN IDENTIFICATION                                 │
│    • findMetaColumns() - finds SubjectName, Relation... │
│    • OUT_OF_PATTERN - finds rating columns              │
│    • QUESTION_INDEX_PATTERN - extracts N.M prefix       │
│    Output: CsvMetaColumns, RatingColumn[]               │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ 3. SECTION STRUCTURE BUILDING                            │
│    • Group rating columns by section number             │
│    • Create Section → Question hierarchy                │
│    Output: sections[]                                    │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ 4. DATA ROW EXTRACTION                                   │
│    For each row (after header):                         │
│    • Extract subject info                               │
│    • Extract relation type                              │
│    • Map all ratings to question IDs                    │
│    Output: RowData[]                                     │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ 5. GROUPING                                              │
│    • Group rows by SubjectKey (email || name)           │
│    • Within each subject, group by Relation             │
│    Output: Map<SubjectKey, Map<Relation, RowData[]>>    │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ 6. PER-RELATIONSHIP CALCULATION                          │
│    For each subject → each relationship:                │
│    • Average raw values per question                    │
│    • Normalize each average                             │
│    • Compute section averages                           │
│    • Compute relationship overall                       │
│    Output: RelationshipResult[]                         │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ 7. SUBJECT OVERALL CALCULATION                           │
│    • Mean of per-relationship question averages         │
│    • Compute overallSections                            │
│    • Mean of relationship overall scores                │
│    Output: SubjectResult[]                              │
└─────────────────────────────────────────────────────────┘
    │
    ▼
OUTPUT: ParsedCsvBySubjectResult
```

---

## Normalization Calculations

### Core Formula

```
┌─────────────────────────────────────────────────────────────────┐
│  NORMALIZATION FORMULA                                          │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Given:                                                         │
│    • raw = original rating value (e.g., 3)                     │
│    • scaleMax = maximum scale value (e.g., 5)                  │
│    • normalizeToValue = target scale (e.g., 5, 10)             │
│                                                                 │
│  Calculate:                                                     │
│    percentage = (raw / scaleMax) × 100                         │
│    score = (raw / scaleMax) × normalizeToValue                 │
│                                                                 │
│  Example (raw=3, scaleMax=5, normalizeToValue=5):              │
│    percentage = (3 / 5) × 100 = 60%                            │
│    score = (3 / 5) × 5 = 3.0                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Aggregation Hierarchy

```
                    ┌─────────────────────┐
                    │  SUBJECT OVERALL    │
                    │  Score = 3.8        │
                    └──────────┬──────────┘
                               │
            ┌──────────────────┼──────────────────┐
            │                  │                  │
            ▼                  ▼                  ▼
    ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
    │ Self = 4.0    │  │ Peer = 3.7    │  │ Manager = 3.8 │
    └───────┬───────┘  └───────┬───────┘  └───────┬───────┘
            │                  │                  │
            │         ┌───────┴───────┐           │
            │         │               │           │
            ▼         ▼               ▼           ▼
        Section 1  Section 1      Section 1   Section 1
        Avg: 4.0   Avg: 3.5       Avg: 4.0    Avg: 3.8
            │         │               │           │
            ▼         ▼               ▼           ▼
         Q1: 4      Q1: 3.5         Q1: 4       Q1: 4
         Q2: 4      Q2: 3.5         Q2: 4       Q2: 3.5
```

### Calculation Rules

#### 1. Per-Question Average (within relationship)

```
For Question Q1 with Peer relationship (2 evaluators):
  Evaluator A: 3
  Evaluator B: 4
  
  Question Average = (3 + 4) / 2 = 3.5
```

#### 2. Section Average

```
Section has 3 questions:
  Q1: 3.5 (already averaged across evaluators)
  Q2: 4.0
  Q3: 3.0
  
  Section Average = (3.5 + 4.0 + 3.0) / 3 = 3.5
```

#### 3. Relationship Overall

```
Relationship has 2 sections:
  Section 1: 3.5
  Section 2: 4.0
  
  Relationship Overall = (3.5 + 4.0) / 2 = 3.75
  
  OR (if using all questions):
  All Questions: [3.5, 4.0, 3.0, 4.0, 4.0, 3.5]
  Overall = mean([3.5, 4.0, 3.0, 4.0, 4.0, 3.5]) = 3.67
```

#### 4. Subject Overall (KEY CALCULATION)

```
Subject has 3 relationships:
  Self: 4.0 (1 evaluator)
  Peer: 3.7 (3 evaluators)  
  Manager: 3.8 (1 evaluator)
  
  ❌ WRONG: Average all raw ratings (gives more weight to Peer)
     = mean(all 5 evaluators' ratings)
  
  ✅ CORRECT: Average relationship scores (equal weight per relationship)
     = (4.0 + 3.7 + 3.8) / 3 = 3.83 ≈ 3.8
```

---

## Data Structures

### Input Types

```typescript
interface NormalizationOptions {
  normalizeToValue: number;    // Target scale (5, 10, etc.)
  scaleLength: number;         // Original scale max (usually 5)
  startScaleFromZero: boolean; // If true, scale is 0-N instead of 1-N
  roundingActive: boolean;     // Enable rounding
  roundingDecimals: number;    // Decimal places for rounding
}
```

### Internal Types

```typescript
interface RatingColumn {
  header: string;        // Original header text
  columnIndex: number;   // Column position in CSV
  scaleLength: number;   // Extracted from "(Out of N)"
  sectionNum: number;    // From "N.M" prefix
  questionNum: number;   // From "N.M" prefix
}

interface RowData {
  subjectKey: string;           // email || name
  subjectName: string;
  subjectEmail: string;
  relation: string;             // Self, Peer, Manager, Reportee
  evaluator: string;
  ratings: Map<string, number>; // questionId → raw value
}
```

### Output Types

```typescript
interface ParsedCsvBySubjectResult {
  subjects: SubjectResult[];
  scaleLength: number;
  totalResponseCount: number;
  sections: Array<{
    id: string;
    name: string;
    questions: Array<{ id: string; text: string }>;
  }>;
}

interface SubjectResult {
  subjectName: string;
  subjectEmail: string;
  relationships: RelationshipResult[];
  overallSections: NormalizedSectionResult[];
  overallSummary: NormalizedSurveySummary;
}

interface RelationshipResult {
  relation: string;
  evaluatorCount: number;
  sections: NormalizedSectionResult[];
  summary: NormalizedSurveySummary;
}

interface NormalizedSectionResult {
  sectionId: string;
  sectionName: string;
  questions: NormalizedQuestionResult[];
  averagePercentage: number;
  averageScore: number;
}

interface NormalizedQuestionResult {
  questionId: string;
  sectionId: string;
  questionText: string;
  rawValue: number;
  percentage: number;
  score: number;
}

interface NormalizedSurveySummary {
  overallAveragePercentage: number;
  overallAverageScore: number;
}
```

---

## API Flow

### Sequence Diagram

```
┌─────────┐          ┌─────────┐          ┌──────────────┐          ┌───────────┐
│ Browser │          │ Server  │          │ csvParser.ts │          │ Response  │
└────┬────┘          └────┬────┘          └──────┬───────┘          └─────┬─────┘
     │                    │                      │                        │
     │  POST /api/normalize/csv-by-subject       │                        │
     │  {csvText, normalizeToValue, ...}         │                        │
     │───────────────────▶│                      │                        │
     │                    │                      │                        │
     │                    │  parseResponsesCsvBySubject(csvText, options) │
     │                    │─────────────────────▶│                        │
     │                    │                      │                        │
     │                    │                      │ 1. Parse CSV lines     │
     │                    │                      │ 2. Find columns        │
     │                    │                      │ 3. Build sections      │
     │                    │                      │ 4. Parse rows          │
     │                    │                      │ 5. Group by subject    │
     │                    │                      │ 6. Group by relation   │
     │                    │                      │ 7. Calculate scores    │
     │                    │                      │                        │
     │                    │  ParsedCsvBySubjectResult                     │
     │                    │◀─────────────────────│                        │
     │                    │                      │                        │
     │  JSON Response     │                      │                        │
     │◀───────────────────│                      │                        │
     │                    │                      │                        │
     │  renderPerSubjectResults(data)            │                        │
     │────────────────────────────────────────────────────────────────────▶
     │                    │                      │                        │
```

---

## Example Walkthrough

### Input CSV

```csv
SubjectName,SubjectEmail,Relation,EvaluatorName,1.1 - Leadership (Out of 5),1.2 - Teamwork (Out of 5)
John Doe,john@example.com,Self,John Doe,4,5
John Doe,john@example.com,Peer,Jane Smith,3,4
John Doe,john@example.com,Peer,Bob Wilson,4,4
```

### Step 1: Parse Headers

```javascript
headers = [
  "SubjectName",
  "SubjectEmail", 
  "Relation",
  "EvaluatorName",
  "1.1 - Leadership (Out of 5)",
  "1.2 - Teamwork (Out of 5)"
]

metaColumns = {
  subjectNameIdx: 0,
  subjectEmailIdx: 1,
  relationIdx: 2,
  evaluatorNameIdx: 3
}

ratingColumns = [
  { header: "1.1 - Leadership (Out of 5)", columnIndex: 4, scaleLength: 5, sectionNum: 1, questionNum: 1 },
  { header: "1.2 - Teamwork (Out of 5)", columnIndex: 5, scaleLength: 5, sectionNum: 1, questionNum: 2 }
]
```

### Step 2: Build Section Structure

```javascript
sections = [
  {
    id: "S1",
    name: "Section 1",
    questions: [
      { id: "S1_Q1", text: "Leadership" },
      { id: "S1_Q2", text: "Teamwork" }
    ]
  }
]
```

### Step 3: Parse Data Rows

```javascript
rows = [
  { subjectKey: "john@example.com", relation: "Self", ratings: { S1_Q1: 4, S1_Q2: 5 } },
  { subjectKey: "john@example.com", relation: "Peer", ratings: { S1_Q1: 3, S1_Q2: 4 } },
  { subjectKey: "john@example.com", relation: "Peer", ratings: { S1_Q1: 4, S1_Q2: 4 } }
]
```

### Step 4: Group by Subject & Relation

```javascript
subjectMap = {
  "john@example.com": {
    name: "John Doe",
    email: "john@example.com",
    rowsByRelation: {
      "Self": [{ ratings: { S1_Q1: 4, S1_Q2: 5 } }],
      "Peer": [
        { ratings: { S1_Q1: 3, S1_Q2: 4 } },
        { ratings: { S1_Q1: 4, S1_Q2: 4 } }
      ]
    }
  }
}
```

### Step 5: Calculate Per-Relationship Scores

```javascript
// Self (1 evaluator)
Self.S1_Q1 = 4 → 80%, 4.0
Self.S1_Q2 = 5 → 100%, 5.0
Self.Section1 = (4.0 + 5.0) / 2 = 4.5
Self.Overall = 4.5

// Peer (2 evaluators)
Peer.S1_Q1 = (3 + 4) / 2 = 3.5 → 70%, 3.5
Peer.S1_Q2 = (4 + 4) / 2 = 4.0 → 80%, 4.0
Peer.Section1 = (3.5 + 4.0) / 2 = 3.75
Peer.Overall = 3.75
```

### Step 6: Calculate Subject Overall

```javascript
// Question averages (mean of relationship averages)
S1_Q1 = (4 + 3.5) / 2 = 3.75
S1_Q2 = (5 + 4.0) / 2 = 4.5

// Section average
Section1 = (3.75 + 4.5) / 2 = 4.125

// Overall (mean of relationship scores)
Overall = (4.5 + 3.75) / 2 = 4.125 ≈ 4.1 (rounded)
```

### Final Output

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
          "sections": [
            {
              "sectionId": "S1",
              "sectionName": "Section 1",
              "questions": [
                { "questionId": "S1_Q1", "rawValue": 4, "percentage": 80, "score": 4.0 },
                { "questionId": "S1_Q2", "rawValue": 5, "percentage": 100, "score": 5.0 }
              ],
              "averagePercentage": 90,
              "averageScore": 4.5
            }
          ],
          "summary": { "overallAveragePercentage": 90, "overallAverageScore": 4.5 }
        },
        {
          "relation": "Peer",
          "evaluatorCount": 2,
          "sections": [
            {
              "sectionId": "S1",
              "sectionName": "Section 1",
              "questions": [
                { "questionId": "S1_Q1", "rawValue": 3.5, "percentage": 70, "score": 3.5 },
                { "questionId": "S1_Q2", "rawValue": 4, "percentage": 80, "score": 4.0 }
              ],
              "averagePercentage": 75,
              "averageScore": 3.8
            }
          ],
          "summary": { "overallAveragePercentage": 75, "overallAverageScore": 3.8 }
        }
      ],
      "overallSections": [
        {
          "sectionId": "S1",
          "sectionName": "Section 1",
          "questions": [
            { "questionId": "S1_Q1", "rawValue": 3.8, "percentage": 75, "score": 3.8 },
            { "questionId": "S1_Q2", "rawValue": 4.5, "percentage": 90, "score": 4.5 }
          ],
          "averagePercentage": 82.5,
          "averageScore": 4.1
        }
      ],
      "overallSummary": {
        "overallAveragePercentage": 82.5,
        "overallAverageScore": 4.1
      }
    }
  ],
  "scaleLength": 5,
  "totalResponseCount": 3,
  "sections": [...]
}
```

---

## Key Design Decisions

### 1. Equal Weight Per Relationship

The subject's overall score gives equal weight to each relationship type, not each evaluator. This means:
- Self (1 person) = 33% weight
- Peer (3 people) = 33% weight
- Manager (1 person) = 33% weight

This matches ThriveSparrow's calculation methodology.

### 2. Direct Percentage Calculation

We use `(raw / scaleMax) * 100` instead of min-max normalization `((raw - min) / (max - min)) * 100`. This means:
- A rating of 3 on a 5-point scale = 60% (not 50%)
- A rating of 1 on a 5-point scale = 20% (not 0%)

### 3. Section-First Hierarchy

The data structure prioritizes section-level grouping over question-level. This makes it easy to:
- Display competency/section summaries
- Compare sections across subjects
- Generate section-based reports

---

## Files Reference

| File | Purpose |
|------|---------|
| `src/csvParser.ts` | Core CSV parsing and normalization logic |
| `scripts/serve.mjs` | HTTP server with `/api/normalize/csv-by-subject` endpoint |
| `public/index.html` | Frontend UI with file upload and results rendering |
| `src/types.ts` | TypeScript type definitions |
