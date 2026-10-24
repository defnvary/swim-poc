// server/src/db/models.ts — single source of truth for data shapes
import { DataTypes, type Sequelize } from 'sequelize';

export const defineModels = (sequelize: Sequelize) => {
  const User = sequelize.define('User', {
    id:           { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    username:     { type: DataTypes.STRING, allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING, allowNull: false },
    role:         { type: DataTypes.ENUM('admin', 'member', 'viewer'), allowNull: false, defaultValue: 'member' },
    active:       { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  });

  const RefreshToken = sequelize.define('RefreshToken', {
    id:        { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    familyId:  { type: DataTypes.UUID, allowNull: false },
    userId:    { type: DataTypes.UUID, allowNull: false },
    tokenHash: { type: DataTypes.STRING, allowNull: false, unique: true },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    revokedAt: { type: DataTypes.DATE, allowNull: true },
  }, { updatedAt: false, indexes: [{ fields: ['familyId'] }] });

  const App = sequelize.define('App', {
    id:                  { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name:                { type: DataTypes.STRING, allowNull: false },
    slug:                { type: DataTypes.STRING, allowNull: false, unique: true },
    repoOwner:           { type: DataTypes.STRING, allowNull: false },
    repoName:            { type: DataTypes.STRING, allowNull: false },
    branch:              { type: DataTypes.STRING, allowNull: false, defaultValue: 'main' },
    port:                { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3000 },
    healthcheckPath:     { type: DataTypes.STRING, allowNull: false, defaultValue: '/' },
    buildType:           { type: DataTypes.ENUM('auto', 'dockerfile', 'node', 'static'), allowNull: false, defaultValue: 'auto' },
    autoDeploy:          { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    accessTokenEnc:      { type: DataTypes.STRING, allowNull: true },   // fine-grained PAT, AES-256-GCM
    webhookSecretEnc:    { type: DataTypes.STRING, allowNull: false },  // AES-256-GCM
    hookId:              { type: DataTypes.UUID, allowNull: false, unique: true },
    status:              { type: DataTypes.ENUM('created', 'building', 'live', 'failed', 'stopped'), allowNull: false, defaultValue: 'created' },
    currentDeploymentId: { type: DataTypes.UUID, allowNull: true },
    createdById:         { type: DataTypes.UUID, allowNull: false },
  }, { indexes: [{ fields: ['createdById'] }] });

  const Deployment = sequelize.define('Deployment', {
    id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    appId:         { type: DataTypes.UUID, allowNull: false },
    commitSha:     { type: DataTypes.CHAR(40), allowNull: false },
    commitMessage: { type: DataTypes.STRING, allowNull: true },
    author:        { type: DataTypes.STRING, allowNull: true },
    branch:        { type: DataTypes.STRING, allowNull: false },
    status:        { type: DataTypes.ENUM('queued', 'fetching', 'building', 'deploying', 'live', 'failed'), allowNull: false, defaultValue: 'queued' },
    trigger:       { type: DataTypes.ENUM('webhook', 'manual'), allowNull: false },
    userId:        { type: DataTypes.UUID, allowNull: true },
    error:         { type: DataTypes.TEXT, allowNull: true },
    startedAt:     { type: DataTypes.DATE, allowNull: true },
    finishedAt:    { type: DataTypes.DATE, allowNull: true },
  }, { updatedAt: false, indexes: [{ fields: ['appId', 'createdAt'] }, { fields: ['status'] }] });

  const Domain = sequelize.define('Domain', {
    id:           { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    appId:        { type: DataTypes.UUID, allowNull: false },
    host:         { type: DataTypes.STRING, allowNull: false, unique: true },
    certStatus:   { type: DataTypes.ENUM('pending', 'issued', 'failed'), allowNull: false, defaultValue: 'pending' },
    certIssuedAt: { type: DataTypes.DATE, allowNull: true },
  }, { updatedAt: false, indexes: [{ fields: ['appId'] }] });

  const EnvVar = sequelize.define('EnvVar', {
    appId:    { type: DataTypes.UUID, allowNull: false, primaryKey: true },
    key:      { type: DataTypes.STRING, allowNull: false, primaryKey: true },
    valueEnc: { type: DataTypes.STRING, allowNull: false },  // AES-256-GCM
  }, { createdAt: false });

  const Event = sequelize.define('Event', {
    id:         { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId:     { type: DataTypes.UUID, allowNull: true },
    action:     { type: DataTypes.STRING, allowNull: false },
    targetType: { type: DataTypes.STRING, allowNull: true },
    targetId:   { type: DataTypes.STRING, allowNull: true },
    details:    { type: DataTypes.JSONB, allowNull: true },
  }, { updatedAt: false, indexes: [{ fields: ['createdAt'] }, { fields: ['action'] }] });

  // associations — query convenience (include/joins); FK constraints live in the migrations
  User.hasMany(RefreshToken, { foreignKey: 'userId', onDelete: 'CASCADE' });
  RefreshToken.belongsTo(User, { foreignKey: 'userId', onDelete: 'CASCADE' });
  User.hasMany(App, { foreignKey: 'createdById' });               // users are never deleted (§4)
  App.belongsTo(User, { as: 'createdBy', foreignKey: 'createdById' });
  App.hasMany(Deployment, { foreignKey: 'appId', onDelete: 'CASCADE' });
  Deployment.belongsTo(App, { foreignKey: 'appId', onDelete: 'CASCADE' });
  App.hasMany(Domain, { foreignKey: 'appId', onDelete: 'CASCADE' });
  Domain.belongsTo(App, { foreignKey: 'appId', onDelete: 'CASCADE' });
  App.hasMany(EnvVar, { foreignKey: 'appId', onDelete: 'CASCADE' });
  App.belongsTo(Deployment, { as: 'currentDeployment', foreignKey: 'currentDeploymentId' }); // no cascade
  User.hasMany(Deployment, { foreignKey: 'userId' });
  Event.belongsTo(User, { foreignKey: 'userId', onDelete: 'SET NULL' });

  return { User, RefreshToken, App, Deployment, Domain, EnvVar, Event };
};
