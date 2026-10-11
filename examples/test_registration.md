# User registration

## TC1: Register with valid data
**Preconditions:** User is logged out. Email `new.user@example.com` is not registered.
**Priority:** High

| # | Step | Expected result |
|---|------|-----------------|
| 1 | Open `/register` | Registration form is shown |
| 2 | Fill in name, email `new.user@example.com`, password `Str0ng!Pass` | Fields accept the input |
| 3 | Click **Create account** | User is redirected to the dashboard and sees "Welcome" |

## TC2: Register with an email that is already taken
**Preconditions:** `taken@example.com` is already registered.
**Priority:** Medium

| # | Step | Expected result |
|---|------|-----------------|
| 1 | Open `/register` | Registration form is shown |
| 2 | Enter email `taken@example.com` and a valid password, click **Create account** | Error "This email is already registered" is shown under the email field |

## TC3: Password does not meet the rules
**Priority:** Medium

| # | Step | Expected result |
|---|------|-----------------|
| 1 | Open `/register` and enter password `123` | Hint lists the password rules |
| 2 | Click **Create account** | Account is not created; the password field is highlighted |
