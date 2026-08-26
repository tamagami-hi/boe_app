DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM investor_profiles LIMIT 1) THEN
    RAISE EXCEPTION 'investor_profiles contains data; review retention and migrate before removal';
  END IF;
  IF EXISTS (SELECT 1 FROM kyc_documents LIMIT 1) THEN
    RAISE EXCEPTION 'kyc_documents contains data; review retention and migrate before removal';
  END IF;
  IF EXISTS (SELECT 1 FROM kyc_reviews LIMIT 1) THEN
    RAISE EXCEPTION 'kyc_reviews contains data; review retention and migrate before removal';
  END IF;
  IF EXISTS (SELECT 1 FROM risk_assessments LIMIT 1) THEN
    RAISE EXCEPTION 'risk_assessments contains data; review retention and migrate before removal';
  END IF;
  IF EXISTS (SELECT 1 FROM marketing_leads LIMIT 1) THEN
    RAISE EXCEPTION 'marketing_leads contains data; review retention and migrate before removal';
  END IF;
  IF EXISTS (SELECT 1 FROM legacy_investment_reviews LIMIT 1) THEN
    RAISE EXCEPTION 'legacy_investment_reviews contains data; review retention and migrate before removal';
  END IF;
END $$;

DO $$
DECLARE
  verified_users bigint;
  codes_without_users bigint;
BEGIN
  SELECT count(*) INTO verified_users
  FROM users
  WHERE email_verification_state = 'verified'
    AND email_verified_at IS NULL;
  IF verified_users > 0 THEN
    RAISE EXCEPTION 'verified email accounts must have email_verified_at';
  END IF;
  SELECT count(*) INTO codes_without_users
  FROM email_verification_codes codes
  LEFT JOIN users ON users.id = codes.user_id
  WHERE users.id IS NULL;
  IF codes_without_users > 0 THEN
    RAISE EXCEPTION 'email verification codes must reference durable users';
  END IF;
END $$;

DROP TABLE kyc_verification_codes;
DROP TABLE kyc_documents;
DROP TABLE kyc_reviews;
DROP TABLE kyc_cases;
DROP TABLE investor_profiles;
DROP TABLE risk_assessments;
DROP TABLE marketing_leads;
DROP TABLE legacy_investment_reviews;

DROP TYPE IF EXISTS kyc_case_state;
DROP TYPE IF EXISTS risk_assessment_state;
DROP TYPE IF EXISTS risk_category;
DROP TYPE IF EXISTS legacy_review_state;
