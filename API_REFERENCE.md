# Enscribe API Reference

Complete API documentation for frontend developers integrating with the Enscribe backend.

## Table of Contents

- [Authentication API](#authentication-api)
- [Patient Encounters API](#patient-encounters-api)
- [Dot Phrases API](#dot-phrases-api)
- [Status Codes Reference](#status-codes-reference)
- [Error Handling](#error-handling)

---

## Authentication API

### Overview

The Authentication API handles user registration, login, and session management. All other endpoints require a valid access token obtained through authentication.

### Endpoints

#### 1. Sign Up
**POST** `/api/auth`

Create a new user account.

**Request:**
```json
{
  "action": "sign-up",
  "email": "newuser@example.com",
  "password": "SecurePassword123!"
}
```

**Field Validation:**
- `action` (required): Must be `"sign-up"`
- `email` (required): Valid email format
- `password` (required): String, minimum 8 characters, should include uppercase, lowercase, numbers

**Response (200 OK):**
```json
{
  "user": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "email": "newuser@example.com",
    "email_confirmed_at": null
  },
  "session": {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "token_type": "bearer",
    "expires_in": 3600,
    "refresh_token": "..."
  }
}
```

**Status Codes:**
- `200 OK` - Account created successfully
- `400 Bad Request` - Invalid email format, weak password, or missing fields
- `409 Conflict` - Email already registered

**Example (JavaScript):**
```javascript
const response = await fetch('/api/auth', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'sign-up',
    email: 'newuser@example.com',
    password: 'SecurePassword123!'
  })
});

if (response.ok) {
  const { user, session } = await response.json();
  localStorage.setItem('accessToken', session.access_token);
  console.log('Account created for:', user.email);
}
```

---

#### 2. Sign In
**POST** `/api/auth`

Authenticate with existing credentials.

**Request:**
```json
{
  "action": "sign-in",
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

**Field Validation:**
- `action` (required): Must be `"sign-in"`
- `email` (required): Email address of registered user
- `password` (required): User's password

**Response (200 OK):**
```json
{
  "user": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "email": "user@example.com",
    "email_confirmed_at": "2025-12-28T10:15:20Z"
  },
  "session": {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "token_type": "bearer",
    "expires_in": 3600,
    "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Status Codes:**
- `200 OK` - Sign-in successful
- `400 Bad Request` - Missing email or password
- `401 Unauthorized` - Invalid email/password combination

**Example (JavaScript):**
```javascript
const response = await fetch('/api/auth', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'sign-in',
    email: 'user@example.com',
    password: 'SecurePassword123!'
  })
});

if (response.ok) {
  const { user, session } = await response.json();
  localStorage.setItem('accessToken', session.access_token);
  localStorage.setItem('refreshToken', session.refresh_token);
  window.location.href = '/dashboard';
} else if (response.status === 401) {
  alert('Invalid email or password');
}
```

---

#### 3. Sign Out
**POST** `/api/auth`

End the current session (client-side operation in most cases).

**Request:**
```json
{
  "action": "sign-out"
}
```

**Response (200 OK):**
```json
{
  "message": "Signed out successfully"
}
```

**Example (JavaScript):**
```javascript
async function handleSignOut() {
  // Clear local storage
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  
  // Redirect to login
  window.location.href = '/login';
}
```

---

#### 4. Check Email Validity
**POST** `/api/auth`

Check if an email is already registered.

**Request:**
```json
{
  "action": "check-validity",
  "email": "user@example.com"
}
```

**Response (200 OK):**
```json
{
  "valid": false,
  "email": "user@example.com"
}
```

**Response Fields:**
- `valid`: `true` if email is available, `false` if already registered

**Example (JavaScript):**
```javascript
async function checkEmailAvailability(email) {
  const response = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'check-validity',
      email: email
    })
  });

  const { valid } = await response.json();
  return valid;
}
```

---

#### 5. Resend Confirmation Email
**POST** `/api/auth`

Resend email confirmation link to user.

**Request:**
```json
{
  "action": "resend-confirmation",
  "email": "user@example.com"
}
```

**Response (200 OK):**
```json
{
  "message": "Confirmation email sent"
}
```

**Example (JavaScript):**
```javascript
async function resendConfirmationEmail(email) {
  const response = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'resend-confirmation',
      email: email
    })
  });

  if (response.ok) {
    alert('Confirmation email sent. Please check your inbox.');
  }
}
```

---

## Patient Encounters API

### Overview

Patient encounters represent individual patient interactions/appointments. Each encounter can have:
- A name/description
- Associated recordings
- Transcripts (generated from recordings)
- SOAP notes

**Important:** The `name` field is encrypted on the server side. When you update the name, the server handles encryption/decryption automatically.

### Endpoints

#### 1. Create Patient Encounter
**POST** `/api/patient-encounters`

Create a new patient encounter.

**Request:**
```json
{
  "name": "Follow-up appointment - Patient review",
  "recording_file_path": "https://storage.example.com/recording.mp3",
  "recording_file_signed_url": "https://signed-url...",
  "recording_file_signed_url_expiry": "2025-12-31T23:59:59Z"
}
```

**Field Validation:**
- `name` (required): String, minimum 1 character
- `recording_file_path` (optional): String, file path to recording
- `recording_file_signed_url` (optional): String, signed URL for direct access
- `recording_file_signed_url_expiry` (optional): ISO 8601 datetime string

**Response (201 Created):**
```json
{
  "id": 12345,
  "name": "Follow-up appointment - Patient review",
  "recording_file_path": "https://storage.example.com/recording.mp3",
  "recording_file_signed_url": "https://signed-url...",
  "recording_file_signed_url_expiry": "2025-12-31T23:59:59Z",
  "created_at": "2025-12-29T15:30:45Z",
  "updated_at": "2025-12-29T15:30:45Z"
}
```

**Example (cURL):**
```bash
curl -X POST http://localhost:3000/api/patient-encounters \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Follow-up appointment - Patient review",
    "recording_file_path": "https://storage.example.com/recording.mp3"
  }'
```

**Example (JavaScript):**
```javascript
const response = await fetch('/api/patient-encounters', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'Follow-up appointment - Patient review',
    recording_file_path: 'https://storage.example.com/recording.mp3'
  })
});

const encounter = await response.json();
console.log('Created encounter ID:', encounter.id);
```

---

#### 2. Get All Patient Encounters
**GET** `/api/patient-encounters`

Retrieve all patient encounters for the authenticated user.

**Query Parameters:**
- `limit` (optional): Number of results to return (default: 10)
- `offset` (optional): Number of results to skip (default: 0)

**Response (200 OK):**
```json
{
  "encounters": [
    {
      "id": 12345,
      "name": "Follow-up appointment - Patient review",
      "recording_file_path": "https://storage.example.com/recording.mp3",
      "created_at": "2025-12-29T15:30:45Z",
      "updated_at": "2025-12-29T15:30:45Z"
    },
    {
      "id": 12346,
      "name": "Initial consultation",
      "recording_file_path": "https://storage.example.com/recording2.mp3",
      "created_at": "2025-12-28T10:15:20Z",
      "updated_at": "2025-12-28T10:15:20Z"
    }
  ],
  "count": 2
}
```

**Example (JavaScript):**
```javascript
const response = await fetch('/api/patient-encounters?limit=20', {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});

const { encounters, count } = await response.json();
console.log(`Found ${count} encounters`);
encounters.forEach(e => console.log(e.name));
```

---

#### 3. Get Single Patient Encounter
**GET** `/api/patient-encounters/{id}`

Retrieve a specific patient encounter by ID.

**Parameters:**
- `id` (required): Numeric ID of the encounter

**Response (200 OK):**
```json
{
  "id": 12345,
  "name": "Follow-up appointment - Patient review",
  "recording_file_path": "https://storage.example.com/recording.mp3",
  "recording_file_signed_url": "https://signed-url...",
  "recording_file_signed_url_expiry": "2025-12-31T23:59:59Z",
  "created_at": "2025-12-29T15:30:45Z",
  "updated_at": "2025-12-29T15:30:45Z"
}
```

**Status Codes:**
- `200 OK` - Encounter found and returned
- `400 Bad Request` - Invalid ID format (not numeric)
- `404 Not Found` - Encounter doesn't exist or doesn't belong to user
- `401 Unauthorized` - Missing or invalid token

**Example (JavaScript):**
```javascript
const response = await fetch('/api/patient-encounters/12345', {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});

if (response.status === 404) {
  console.error('Encounter not found');
} else if (response.ok) {
  const encounter = await response.json();
  console.log('Encounter name:', encounter.name);
}
```

---

#### 4. Update Patient Encounter
**PATCH** `/api/patient-encounters/{id}`

Update a patient encounter (e.g., change the name).

**Parameters:**
- `id` (required): Numeric ID of the encounter

**Request:**
```json
{
  "name": "Updated appointment name"
}
```

**Field Validation:**
- `name` (optional): String, minimum 1 character

**Response (200 OK):**
```json
{
  "id": 12345,
  "name": "Updated appointment name",
  "recording_file_path": "https://storage.example.com/recording.mp3",
  "updated_at": "2025-12-29T15:45:30Z"
}
```

**Status Codes:**
- `200 OK` - Encounter updated successfully
- `400 Bad Request` - Invalid ID format or invalid request body
- `404 Not Found` - Encounter doesn't exist or doesn't belong to user
- `401 Unauthorized` - Missing or invalid token

**Example (JavaScript):**
```javascript
const response = await fetch('/api/patient-encounters/12345', {
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'Updated appointment name'
  })
});

if (response.ok) {
  const updated = await response.json();
  console.log('Updated at:', updated.updated_at);
}
```

---

#### 5. Delete Patient Encounter
**DELETE** `/api/patient-encounters/{id}`

Delete a patient encounter.

**Parameters:**
- `id` (required): Numeric ID of the encounter

**Response (204 No Content):**
Empty response body.

**Status Codes:**
- `204 No Content` - Encounter deleted successfully
- `400 Bad Request` - Invalid ID format
- `404 Not Found` - Encounter doesn't exist or doesn't belong to user
- `401 Unauthorized` - Missing or invalid token

**Example (JavaScript):**
```javascript
const response = await fetch('/api/patient-encounters/12345', {
  method: 'DELETE',
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});

if (response.status === 204) {
  console.log('Encounter deleted successfully');
} else if (response.status === 404) {
  console.error('Encounter not found');
}
```

---

#### 6. Mark Encounter as Complete
**POST** `/api/patient-encounters/{id}/complete`

Mark a patient encounter as complete.

**Parameters:**
- `id` (required): Numeric ID of the encounter

**Request:** Empty body

**Response (200 OK):**
```json
{
  "id": 12345,
  "status": "completed",
  "completed_at": "2025-12-29T15:50:00Z"
}
```

**Status Codes:**
- `200 OK` - Encounter marked as complete
- `400 Bad Request` - Invalid ID format
- `404 Not Found` - Encounter doesn't exist or doesn't belong to user
- `401 Unauthorized` - Missing or invalid token

**Example (JavaScript):**
```javascript
const response = await fetch('/api/patient-encounters/12345/complete', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});

if (response.ok) {
  const result = await response.json();
  console.log('Completed at:', result.completed_at);
}
```

---

## Dot Phrases API

### Overview

Dot phrases are custom medical phrase templates that allow healthcare providers to quickly insert frequently used text snippets. A dot phrase consists of:
- **Trigger**: Short keyword to activate the phrase (e.g., "hpi", "hx")
- **Expansion**: Full text that gets inserted when trigger is typed (e.g., "History of Present Illness")

### Endpoints

#### 1. Get All Dot Phrases
**GET** `/api/dotphrases`

Retrieve all dot phrases for the authenticated user.

**Query Parameters:**
- `limit` (optional): Number of results to return (default: 100)
- `offset` (optional): Number of results to skip (default: 0)

**Response (200 OK):**
```json
{
  "dotPhrases": [
    {
      "id": "uuid-1234-5678",
      "trigger": "hpi",
      "expansion": "History of Present Illness",
      "created_at": "2025-12-28T10:15:20Z",
      "updated_at": "2025-12-28T10:15:20Z"
    },
    {
      "id": "uuid-2345-6789",
      "trigger": "hx",
      "expansion": "History of...",
      "created_at": "2025-12-28T10:15:20Z",
      "updated_at": "2025-12-28T10:15:20Z"
    }
  ],
  "count": 2
}
```

**Status Codes:**
- `200 OK` - Phrases retrieved successfully
- `401 Unauthorized` - Missing or invalid token

**Example (JavaScript):**
```javascript
const response = await fetch('/api/dotphrases?limit=50', {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});

const { dotPhrases, count } = await response.json();
console.log(`Found ${count} dot phrases`);
dotPhrases.forEach(phrase => {
  console.log(`${phrase.trigger} → ${phrase.expansion}`);
});
```

---

#### 2. Get Single Dot Phrase
**GET** `/api/dotphrases/{id}`

Retrieve a specific dot phrase by ID.

**Parameters:**
- `id` (required): UUID of the dot phrase

**Response (200 OK):**
```json
{
  "id": "uuid-1234-5678",
  "trigger": "hpi",
  "expansion": "History of Present Illness",
  "created_at": "2025-12-28T10:15:20Z",
  "updated_at": "2025-12-28T10:15:20Z"
}
```

**Status Codes:**
- `200 OK` - Phrase found and returned
- `404 Not Found` - Phrase doesn't exist or belongs to different user
- `401 Unauthorized` - Missing or invalid token

**Example (JavaScript):**
```javascript
const response = await fetch('/api/dotphrases/uuid-1234-5678', {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});

if (response.ok) {
  const phrase = await response.json();
  console.log(`Trigger: ${phrase.trigger}`);
  console.log(`Expansion: ${phrase.expansion}`);
}
```

---

#### 3. Create Dot Phrase
**POST** `/api/dotphrases`

Create a new dot phrase.

**Request:**
```json
{
  "trigger": "hpi",
  "expansion": "History of Present Illness"
}
```

**Field Validation:**
- `trigger` (required): String, identifier for the phrase (e.g., "hpi", "ros")
- `expansion` (required): String, the full text to insert

**Response (201 Created):**
```json
{
  "id": "uuid-1234-5678",
  "trigger": "hpi",
  "expansion": "History of Present Illness",
  "created_at": "2025-12-29T15:30:45Z",
  "updated_at": "2025-12-29T15:30:45Z"
}
```

**Status Codes:**
- `201 Created` - Phrase created successfully
- `400 Bad Request` - Invalid request body
- `401 Unauthorized` - Missing or invalid token

**Example (JavaScript):**
```javascript
const response = await fetch('/api/dotphrases', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    trigger: 'hpi',
    expansion: 'History of Present Illness'
  })
});

if (response.ok) {
  const newPhrase = await response.json();
  console.log('Created phrase with ID:', newPhrase.id);
}
```

---

#### 4. Update Dot Phrase
**PATCH** `/api/dotphrases/{id}`

Update an existing dot phrase.

**Parameters:**
- `id` (required): UUID of the dot phrase

**Request:**
```json
{
  "trigger": "hpi",
  "expansion": "Updated expansion text"
}
```

**Field Validation:**
- `trigger` (optional): String
- `expansion` (optional): String

**Response (200 OK):**
```json
{
  "id": "uuid-1234-5678",
  "trigger": "hpi",
  "expansion": "Updated expansion text",
  "updated_at": "2025-12-29T15:45:30Z"
}
```

**Status Codes:**
- `200 OK` - Phrase updated successfully
- `400 Bad Request` - Invalid request body
- `404 Not Found` - Phrase doesn't exist or belongs to different user
- `401 Unauthorized` - Missing or invalid token

**Example (JavaScript):**
```javascript
const response = await fetch('/api/dotphrases/uuid-1234-5678', {
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    expansion: 'Updated expansion text'
  })
});

if (response.ok) {
  const updated = await response.json();
  console.log('Updated at:', updated.updated_at);
}
```

---

#### 5. Delete Dot Phrase
**DELETE** `/api/dotphrases/{id}`

Delete a dot phrase.

**Parameters:**
- `id` (required): UUID of the dot phrase

**Response (204 No Content):**
Empty response body.

**Status Codes:**
- `204 No Content` - Phrase deleted successfully
- `404 Not Found` - Phrase doesn't exist or belongs to different user
- `401 Unauthorized` - Missing or invalid token

**Example (JavaScript):**
```javascript
const response = await fetch('/api/dotphrases/uuid-1234-5678', {
  method: 'DELETE',
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});

if (response.status === 204) {
  console.log('Dot phrase deleted successfully');
} else if (response.status === 404) {
  console.error('Dot phrase not found');
}
```

---

## Status Codes Reference

| Code | Meaning | Action |
|------|---------|--------|
| `200 OK` | Request succeeded | Use the response data |
| `201 Created` | Resource created successfully | Use the new resource |
| `204 No Content` | Request succeeded, no response body | Check status code only |
| `400 Bad Request` | Invalid request format or validation error | Check error message, fix request |
| `401 Unauthorized` | Missing or invalid authentication token | Refresh/re-obtain token |
| `404 Not Found` | Resource doesn't exist or belongs to different user | Verify ID, may need to refresh list |
| `500 Internal Server Error` | Server error | Retry later, contact support if persists |

---

## Error Handling

All error responses include structured error information:

```json
{
  "error": "Error message describing what went wrong"
}
```

For validation errors, additional details may be included:

```json
{
  "error": {
    "name": "ZodError",
    "message": "[\n  {\n    \"code\": \"invalid_type\",\n    \"path\": [\"name\"],\n    \"message\": \"Invalid input: expected string, received undefined\"\n  }\n]"
  }
}
```

**Recommended Error Handling Pattern:**

```javascript
async function makeRequest(endpoint, options = {}) {
  try {
    const response = await fetch(endpoint, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });

    if (!response.ok) {
      const errorData = await response.json();
      
      if (response.status === 401) {
        // Token expired - redirect to login
        window.location.href = '/login';
      } else if (response.status === 404) {
        // Resource not found
        throw new Error('Resource not found');
      } else if (response.status === 400) {
        // Validation error
        throw new Error(errorData.error?.message || 'Invalid request');
      } else {
        throw new Error(errorData.error || 'Request failed');
      }
    }

    // For 204 No Content responses
    if (response.status === 204) {
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}
```

---

## Encryption & Security

### Name Field Encryption

The `name` field is **encrypted at rest** in the database. This means:

- **Frontend:** Send plain text `name` in requests
- **Server:** Automatically encrypts before storing
- **Server:** Automatically decrypts when returning
- **Frontend:** Receive plain text `name` in responses

You don't need to handle encryption/decryption on the frontend. It happens transparently on the server.

### Token Security

```javascript
// ✅ DO: Store token securely
localStorage.setItem('accessToken', response.session.access_token);

// ✅ DO: Include in all authenticated requests
headers: { 'Authorization': `Bearer ${accessToken}` }

// ❌ DON'T: Log or expose tokens
console.log('Token:', token); // Never!

// ❌ DON'T: Send via URL parameters
fetch(`/api/endpoint?token=${token}`); // Wrong!

// ✅ DO: Refresh when expired
// Token expires in 3600 seconds, handle refresh flow
```

---

## Rate Limiting

Currently no rate limiting is enforced, but this may change in production. Recommended guidelines:

- Max 100 requests per minute per endpoint
- Implement exponential backoff for retries
- Cache responses when possible to reduce requests

---

## Examples

### Complete Create & Update Flow

```javascript
import { useState } from 'react';

export function PatientEncounterForm({ accessToken }) {
  const [encounters, setEncounters] = useState([]);
  const [loading, setLoading] = useState(false);

  // Create new encounter
  async function handleCreate(formData) {
    setLoading(true);
    try {
      const response = await fetch('/api/patient-encounters', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: formData.name,
          recording_file_path: formData.recordingPath
        })
      });

      if (!response.ok) {
        throw new Error('Failed to create encounter');
      }

      const newEncounter = await response.json();
      setEncounters([...encounters, newEncounter]);
      alert('Encounter created!');
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  }

  // Update encounter
  async function handleUpdate(encounterId, newName) {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/patient-encounters/${encounterId}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ name: newName })
        }
      );

      if (!response.ok) {
        throw new Error('Failed to update encounter');
      }

      const updated = await response.json();
      setEncounters(
        encounters.map(e => e.id === encounterId ? updated : e)
      );
      alert('Encounter updated!');
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  }

  // Delete encounter
  async function handleDelete(encounterId) {
    if (!window.confirm('Delete this encounter?')) return;

    setLoading(true);
    try {
      const response = await fetch(
        `/api/patient-encounters/${encounterId}`,
        {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }
      );

      if (!response.ok) {
        throw new Error('Failed to delete encounter');
      }

      setEncounters(encounters.filter(e => e.id !== encounterId));
      alert('Encounter deleted!');
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button onClick={() => handleCreate({ name: 'New' })}>
        Create Encounter
      </button>
      {/* List encounters with update/delete buttons */}
    </div>
  );
}
```

---

## Frequently Asked Questions

### Q: How do I refresh an expired token?
**A:** The Supabase client handles this automatically. If your token expires, use the refresh token to get a new one. See your authentication documentation for details.

### Q: Can I update multiple fields at once?
**A:** Currently, the update endpoint only supports updating the `name` field. To update other fields (recording path, etc.), contact the backend team.

### Q: What happens to encounters when I delete them?
**A:** Deleting an encounter is permanent and irreversible. All associated data is removed from the database. Make sure the user confirms before deleting.

### Q: Can I see encounters from other users?
**A:** No. Row-level security policies ensure you only see your own encounters. Attempting to access other users' encounters returns a 404.

### Q: Why is my ID validation returning 400 instead of 404?
**A:** A 400 response means the ID format is invalid (not numeric). A 404 means the ID format is correct but the resource doesn't exist. Always use numeric IDs.

---

## Support & Issues

For issues or questions:
1. Check this reference guide
2. Review the error message returned by the API
3. Verify your token is valid and not expired
4. Check the server is running (`npm run dev`)
5. Contact the backend team with error details

---

**Last Updated:** December 29, 2025  
**API Version:** 1.0  
**Base URL:** `http://localhost:3000` (development)
