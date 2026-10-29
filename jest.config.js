module.exports = {
  projects: [
    {
      displayName: 'frontend',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/frontend/**/__tests__/**/*.test.ts?(x)'],
      moduleNameMapper: {
        '^@frontend/(.*)$': '<rootDir>/frontend/$1',
        '^@backend/(.*)$': '<rootDir>/backend/$1',
      },
      transform: {
        '^.+\\.tsx?$': 'ts-jest',
      },
      moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
      setupFilesAfterEnv: ['<rootDir>/frontend/jest.setup.ts'],
    },
    {
      displayName: 'backend',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/backend/**/__tests__/**/*.test.ts'],
      moduleNameMapper: {
        '^@frontend/(.*)$': '<rootDir>/frontend/$1',
        '^@backend/(.*)$': '<rootDir>/backend/$1',
      },
      transform: {
        '^.+\\.tsx?$': 'ts-jest',
      },
      moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    },
  ],
  collectCoverageFrom: [
    'backend/services/**/*.ts',
    'backend/middleware/**/*.ts',
    'frontend/pages/api/**/*.ts',
    '!**/__tests__/**',
    '!**/node_modules/**',
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
};
