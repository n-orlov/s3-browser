import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AwsProfileProvider, useAwsProfiles } from '../renderer/context/AwsProfileContext';
import { mockElectronAPI } from './setup';

// Test component that displays and can change profile
function TestProfileConsumer() {
  const { currentProfile, profiles, selectProfile, loading, error } = useAwsProfiles();

  if (loading) return <div data-testid="loading">Loading...</div>;
  if (error) return <div data-testid="error">{error}</div>;

  return (
    <div>
      <div data-testid="current-profile">{currentProfile || 'none'}</div>
      <ul data-testid="profiles-list">
        {profiles.map((p) => (
          <li key={p.name} data-testid={`profile-${p.name}`}>
            {p.name}
          </li>
        ))}
      </ul>
      <button
        data-testid="select-dev"
        onClick={() => selectProfile('dev')}
      >
        Select Dev
      </button>
    </div>
  );
}

// Two consumers to test shared state
function TwoConsumersTest() {
  return (
    <div>
      <div data-testid="consumer-1">
        <TestProfileConsumer />
      </div>
      <div data-testid="consumer-2">
        <TestProfileConsumer />
      </div>
    </div>
  );
}

describe('AwsProfileContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockElectronAPI.aws.getProfiles.mockResolvedValue({
      profiles: [
        { name: 'default', hasCredentials: true, isValid: true, profileType: 'role', profileTypeDescription: 'IAM Role' },
        { name: 'dev', hasCredentials: true, isValid: true, profileType: 'role', profileTypeDescription: 'IAM Role' },
        { name: 'prod', hasCredentials: true, isValid: true, profileType: 'role', profileTypeDescription: 'IAM Role' },
      ],
      currentProfile: null,
      defaultRegion: 'eu-west-1',
    });
    mockElectronAPI.aws.setProfile.mockResolvedValue({ success: true });
    mockElectronAPI.s3.clearClient.mockResolvedValue(undefined);
  });

  it('loads profiles on mount', async () => {
    render(
      <AwsProfileProvider>
        <TestProfileConsumer />
      </AwsProfileProvider>
    );

    // Initially loading
    expect(screen.getByTestId('loading')).toBeInTheDocument();

    // After loading, should show profiles
    await waitFor(() => {
      expect(screen.getByTestId('profiles-list')).toBeInTheDocument();
    });

    expect(screen.getByTestId('profile-default')).toBeInTheDocument();
    expect(screen.getByTestId('profile-dev')).toBeInTheDocument();
    expect(screen.getByTestId('profile-prod')).toBeInTheDocument();
    expect(screen.getByTestId('current-profile')).toHaveTextContent('none');
  });

  it('shares profile state between multiple consumers', async () => {
    const user = userEvent.setup();

    render(
      <AwsProfileProvider>
        <TwoConsumersTest />
      </AwsProfileProvider>
    );

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryAllByTestId('loading')).toHaveLength(0);
    });

    // Both consumers should show no current profile
    const currentProfiles = screen.getAllByTestId('current-profile');
    expect(currentProfiles).toHaveLength(2);
    expect(currentProfiles[0]).toHaveTextContent('none');
    expect(currentProfiles[1]).toHaveTextContent('none');

    // Click select button in first consumer
    const selectButtons = screen.getAllByTestId('select-dev');
    await user.click(selectButtons[0]);

    // Both consumers should now show the same profile
    await waitFor(() => {
      const updatedProfiles = screen.getAllByTestId('current-profile');
      expect(updatedProfiles[0]).toHaveTextContent('dev');
      expect(updatedProfiles[1]).toHaveTextContent('dev');
    });

    // Verify API calls
    expect(mockElectronAPI.s3.clearClient).toHaveBeenCalled();
    expect(mockElectronAPI.aws.setProfile).toHaveBeenCalledWith('dev');
  });

  it('clears S3 client when profile is changed', async () => {
    const user = userEvent.setup();

    render(
      <AwsProfileProvider>
        <TestProfileConsumer />
      </AwsProfileProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    await user.click(screen.getByTestId('select-dev'));

    await waitFor(() => {
      expect(mockElectronAPI.s3.clearClient).toHaveBeenCalled();
    });

    // clearClient should be called before setProfile
    expect(mockElectronAPI.s3.clearClient).toHaveBeenCalled();
    expect(mockElectronAPI.aws.setProfile).toHaveBeenCalledWith('dev');
  });

  it('handles profile selection error', async () => {
    mockElectronAPI.aws.setProfile.mockResolvedValue({
      success: false,
      error: 'Failed to assume role',
    });

    const user = userEvent.setup();

    render(
      <AwsProfileProvider>
        <TestProfileConsumer />
      </AwsProfileProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    await user.click(screen.getByTestId('select-dev'));

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('Failed to assume role');
    });
  });

  it('throws error when used outside provider', () => {
    // Suppress console.error for this test
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<TestProfileConsumer />);
    }).toThrow('useAwsProfiles must be used within an AwsProfileProvider');

    consoleError.mockRestore();
  });
});
