# Architecture Documentation

## Repo Map

### Core Routing & Navigation
- `app/index.tsx` - **Root route gate** - handles all routing decisions based on auth/onboarding status
- `app/_layout.tsx` - Root layout providing Stack navigator and context providers
- `app/welcome.tsx` - Login/welcome screen route

### Authentication
- `src/lib/supabase.ts` - Supabase client singleton
- `src/screens/WelcomeScreen.tsx` - Login UI (magic link + password fallback)

### Onboarding Flow
- `src/hooks/use-onboarding-status.ts` - Hook that checks onboarding completion status
- `src/contexts/onboarding-context.tsx` - Context providing refresh function to onboarding screens
- `app/(onboarding)/_layout.tsx` - Onboarding stack layout
- `app/(onboarding)/ownership.tsx` - First onboarding screen (info)
- `app/(onboarding)/vision.tsx` - Vision statement input
- `app/(onboarding)/commitments.tsx` - Commitments picker (creates tasks)
- `app/(onboarding)/rules.tsx` - Rules/consent screen

### Main App (Post-Onboarding)
- `app/(tabs)/_layout.tsx` - Bottom tab navigator layout
- `app/(tabs)/index.tsx` - Home tab (routes to HomeScreen)
- `app/(tabs)/community.tsx` - Community tab
- `app/(tabs)/profile.tsx` - Profile tab with sign out

### Screens (Reusable Components)
- `src/screens/WelcomeScreen.tsx` - Login screen
- `src/screens/HomeScreen.tsx` - Home screen
- `src/screens/CommunityScreen.tsx` - Community screen
- `src/screens/ProfileScreen.tsx` - Profile screen

### Content & Components
- `src/content/quotes.ts` - Rotating quotes data
- `src/components/RotatingQuote.tsx` - Quote display component

---

## Authentication Flow

### How Auth Works

1. **Session Management** (`app/index.tsx` and `app/_layout.tsx`):
   - On mount, calls `supabase.auth.getSession()` to get initial session
   - Subscribes to `supabase.auth.onAuthStateChange()` for real-time updates
   - Maintains `sessionState: 'loading' | 'signed_out' | 'signed_in'`

2. **Login Methods** (`src/screens/WelcomeScreen.tsx`):
   - **Magic Link (Production)**: Uses `supabase.auth.signInWithOtp()` with deep linking
   - **Password (Development)**: Uses `supabase.auth.signInWithPassword()` or `signUp()`
   - Redirect URL configured via `Linking.createURL('/')` for magic link callbacks

3. **Session State**:
   - `'loading'`: Initial state while checking for existing session
   - `'signed_out'`: No active session → redirects to `/welcome`
   - `'signed_in'`: Active session exists → proceeds to onboarding check

4. **Deep Linking**:
   - Magic link emails contain redirect URL (e.g., `nobodycares:///`)
   - Expo Router handles deep link → Supabase processes auth token
   - `onAuthStateChange` fires → session updates → app navigates accordingly

---

## Onboarding Gating

### How Onboarding Gating Works

1. **Status Check** (`src/hooks/use-onboarding-status.ts`):
   - Only runs when `sessionState === 'signed_in'`
   - Queries `public.profiles` table for `vision_statement`
   - Queries `public.tasks` table for active tasks (`is_active = true`)
   - Returns status: `'idle' | 'checking' | 'needs_onboarding' | 'complete' | 'error'`

2. **Completion Criteria**:
   - `profiles.vision_statement IS NOT NULL` AND
   - User has at least 1 task where `tasks.is_active = true` AND `tasks.user_id = auth.uid()`

3. **Routing Logic** (`app/index.tsx`):
   ```
   if sessionState === 'loading' → Loading screen
   if sessionState === 'signed_out' → /welcome
   if sessionState === 'signed_in' && status === 'checking' → Loading screen
   if sessionState === 'signed_in' && status === 'needs_onboarding' → /(onboarding)/ownership
   if sessionState === 'signed_in' && status === 'complete' → /(tabs)
   ```

4. **Onboarding Flow**:
   - **Ownership** → Info screen (no data saved)
   - **Vision** → Saves `profiles.vision_statement` and `profiles.vision_created_at`
   - **Commitments** → Creates tasks in `public.tasks` with `is_active = true`
   - **Rules** → Consent checkbox, then calls `refresh()` to re-check status

5. **Manual Refresh**:
   - Onboarding screens call `refresh()` from `OnboardingContext` after saving data
   - This triggers a new onboarding check without page reload
   - Root layout re-evaluates and routes accordingly

---

## Routing (Expo Router)

### File-Based Routing Structure

Expo Router uses file-based routing where:
- `app/` directory contains routes
- `(tabs)` and `(onboarding)` are route groups (not accessible directly)
- `_layout.tsx` files define navigation structure
- `index.tsx` files are default routes for their directory

### Route Hierarchy

```
app/
├── _layout.tsx          # Root Stack navigator
├── index.tsx            # Root route gate (handles "/")
├── welcome.tsx          # Login screen route
├── modal.tsx            # Modal route (optional)
├── (tabs)/              # Tab navigator group
│   ├── _layout.tsx      # Tabs layout
│   ├── index.tsx        # Home tab → HomeScreen
│   ├── community.tsx    # Community tab
│   └── profile.tsx      # Profile tab
└── (onboarding)/        # Onboarding stack group
    ├── _layout.tsx      # Onboarding stack layout
    ├── ownership.tsx    # First screen
    ├── vision.tsx       # Vision input
    ├── commitments.tsx  # Commitments picker
    └── rules.tsx        # Rules/consent
```

### Route Gate (`app/index.tsx`)

The `app/index.tsx` file is the **single source of truth** for routing decisions:
- Handles the root route "/"
- Checks session state and onboarding status
- Redirects to appropriate route using `<Redirect>` component
- Never directly renders content (only redirects or loading)

### Navigation Flow

1. App starts → `app/index.tsx` mounts
2. Checks session → `sessionState` determined
3. If signed in → checks onboarding status
4. Redirects based on state → Expo Router navigates
5. Target route renders → User sees appropriate screen

---

## Supabase Client

### Location
- **File**: `src/lib/supabase.ts`
- **Export**: `supabase` (singleton client instance)

### Configuration
- Reads from environment variables:
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- Throws error at startup if env vars are missing
- Uses `createClient()` from `@supabase/supabase-js`

### Usage
```typescript
import { supabase } from '@/src/lib/supabase';

// Auth operations
supabase.auth.getSession()
supabase.auth.signInWithOtp()
supabase.auth.signInWithPassword()
supabase.auth.signUp()
supabase.auth.signOut()
supabase.auth.onAuthStateChange()

// Database operations
supabase.from('profiles').select()
supabase.from('tasks').insert()
```

---

## Database Tables

### Onboarding Completion Check

The onboarding status hook queries two tables:

#### 1. `public.profiles`
- **Column**: `vision_statement` (text, nullable)
- **Check**: `vision_statement IS NOT NULL`
- **Updated by**: `app/(onboarding)/vision.tsx`
- **Also sets**: `vision_created_at` (timestamp)

#### 2. `public.tasks`
- **Columns**:
  - `user_id` (uuid, references auth.users)
  - `is_active` (boolean)
  - `title` (text)
- **Check**: At least 1 row where `user_id = auth.uid()` AND `is_active = true`
- **Created by**: `app/(onboarding)/commitments.tsx`
- **Note**: Column is `is_active` (not `active`)

### Required Database Setup

Ensure these tables exist with proper RLS policies:
- `profiles` table with `id` matching `auth.users.id`
- `tasks` table with `user_id` column and `is_active` boolean column
- RLS policies allowing users to read/write their own data

---

## State Management

### Session State
- Managed in `app/index.tsx` and `app/_layout.tsx`
- State: `'loading' | 'signed_out' | 'signed_in'`
- Updated via `getSession()` and `onAuthStateChange()`

### Onboarding Status
- Managed in `src/hooks/use-onboarding-status.ts`
- State: `'idle' | 'checking' | 'needs_onboarding' | 'complete' | 'error'`
- Only runs when `sessionState === 'signed_in'`
- Returns `'idle'` when no session (prevents infinite loading)

### Context
- `OnboardingProvider` (`src/contexts/onboarding-context.tsx`)
- Provides `refresh()` function to onboarding screens
- Wraps onboarding stack in root layout

---

## Key Design Decisions

1. **Single Route Gate**: `app/index.tsx` is the only place that makes routing decisions
2. **No Navigation in Screens**: Onboarding screens don't navigate directly - they call `refresh()` and let the gate handle routing
3. **Explicit Session State**: Separate `sessionState` prevents race conditions and infinite loading
4. **Idle State**: Onboarding hook returns `'idle'` when signed out (not `'checking'`)
5. **Conditional Hook Execution**: Onboarding hook only receives session when `signed_in`, preventing unnecessary checks

---

## Environment Variables

Required in `.env`:
```
EXPO_PUBLIC_SUPABASE_URL=your_project_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

See `.env.example` for template.

