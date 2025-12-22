# Enscribe API

A comprehensive healthcare management platform built with [Next.js](https://nextjs.org) for managing patient encounters, SOAP notes, recordings, and transcripts with advanced AI-powered features.

## Overview

Enscribe API is a full-stack telemedicine application designed for healthcare providers to efficiently manage patient interactions, generate clinical documentation, and transcribe medical recordings. The platform integrates with Google Cloud Platform (GCP) and AWS services for transcription, AI processing, and data masking.

## Features

- **Patient Encounter Management** - Create, view, and edit patient encounters
- **SOAP Notes** - Generate and manage SOAP (Subjective, Objective, Assessment, Plan) notes
- **Audio Recording & Transcription** - Record, upload, and transcribe patient interactions
- **AI-Powered Processing** - Integration with Google Gemini and OpenAI for note generation
- **Dot Phrases** - Custom medical phrase templates for quick documentation
- **PHI Masking** - AWS-powered Protected Health Information masking
- **Authentication** - Secure user authentication with email verification
- **Data Privacy** - Row-level security policies in the database
- **Mobile Support** - React Native mobile application

## Project Structure

```
enscribe-api/
├── src/
│   ├── app/              # Next.js App Router pages and layouts
│   ├── components/       # React components
│   ├── hooks/           # Custom React hooks
│   ├── pages/api/       # API routes and endpoints
│   └── utils/           # Utility functions and helpers
├── mobile/              # React Native mobile app
├── public/              # Static assets and client-side scripts
├── sql/                 # Database schemas and triggers
└── keys/                # SSH keys (for deployment)
```

## Getting Started

### Prerequisites

- Node.js 16+ and npm/yarn
- Supabase account for database
- Google Cloud Platform credentials (for transcription)
- AWS credentials (for PHI masking)
- OpenAI API key (optional)

### Installation

```bash
# Install dependencies
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for Production

```bash
npm run build
npm start
```

## API Endpoints

Key API routes available in `/src/pages/api/`:

- `auth.js` - Authentication endpoints
- `patient-encounters.js` - Patient encounter CRUD operations
- `soap-notes.js` - SOAP note management
- `recordings.js` - Recording upload/download
- `transcripts.js` - Transcript management
- `dot-phrases.js` - Dot phrase operations
- `gcp/transcribe.js` - GCP transcription service
- `aws/mask-phi.js` - AWS PHI masking service

## Database

The application uses Supabase (PostgreSQL) with:
- Row-Level Security (RLS) policies
- Automated triggers for timestamp updates
- Foreign key constraints and referential integrity

See `/sql/` for database schema and policies.

## Environment Variables

Create a `.env.local` file with:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_CLOUD_PROJECT_ID=
GOOGLE_CLOUD_PRIVATE_KEY=
GOOGLE_CLOUD_CLIENT_EMAIL=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
OPENAI_API_KEY=
```

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Supabase Documentation](https://supabase.com/docs)
- [Google Cloud Speech-to-Text](https://cloud.google.com/speech-to-text/docs)
- [AWS Comprehend Medical](https://aws.amazon.com/comprehend/medical/)
