import React from 'react';
import { useAwsProfiles, type ProfileInfo } from '../context/AwsProfileContext';

function ProfileSelector(): React.ReactElement {
  const { profiles, currentProfile, loading, error, selectProfile, refreshProfiles } = useAwsProfiles();

  const handleProfileChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const profileName = event.target.value;
    if (profileName) {
      selectProfile(profileName);
    }
  };

  if (loading) {
    return (
      <div className="profile-selector">
        <span className="profile-label">Profile:</span>
        <span className="profile-loading">Loading...</span>
      </div>
    );
  }

  return (
    <div className="profile-selector">
      <span className="profile-label">Profile:</span>
      <select
        className="profile-dropdown"
        value={currentProfile ?? ''}
        onChange={handleProfileChange}
        disabled={profiles.length === 0}
      >
        <option value="">Select a profile</option>
        {profiles.map((profile: ProfileInfo) => (
          <option
            key={profile.name}
            value={profile.name}
            disabled={!profile.isValid}
            title={profile.isValid
              ? `${profile.profileTypeDescription}${profile.region ? ` - ${profile.region}` : ''}`
              : profile.validationMessage}
          >
            {profile.name}
            {profile.region ? ` (${profile.region})` : ''}
            {profile.isValid ? ` [${profile.profileTypeDescription}]` : ' [invalid]'}
          </option>
        ))}
      </select>
      <button
        className="profile-refresh-btn"
        onClick={refreshProfiles}
        title="Refresh profiles from disk"
        aria-label="Refresh profiles"
      >
        ↻
      </button>
      {error && <span className="profile-error">{error}</span>}
      {profiles.length === 0 && !error && (
        <span className="profile-hint">
          No profiles found. Configure ~/.aws/credentials
        </span>
      )}
    </div>
  );
}

export default ProfileSelector;
