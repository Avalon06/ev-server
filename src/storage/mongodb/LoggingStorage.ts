import { Log, LogLevel, LogType } from '../../types/Log';

import Configuration from '../../utils/Configuration';
import Constants from '../../utils/Constants';
import DatabaseUtils from './DatabaseUtils';
import DbParams from '../../types/database/DbParams';
import Logging from '../../utils/Logging';
import Utils from '../../utils/Utils';
import cfenv from 'cfenv';
import cluster from 'cluster';
import global from './../../types/GlobalType';
import os from 'os';

const MODULE_NAME = 'LoggingStorage';

export default class LoggingStorage {
  public static async deleteLogs(tenantID, deleteUpToDate: Date) {
    // Check Tenant
    await Utils.checkTenant(tenantID);
    // Build filter
    const filters: any = {};
    // Do Not Delete Security Logs
    filters.type = {};
    filters.type.$ne = 'S';
    // Date provided?
    if (deleteUpToDate) {
      filters.timestamp = {};
      filters.timestamp.$lte = Utils.convertToDate(deleteUpToDate);
    } else {
      return;
    }
    // Delete Logs
    const result = await global.database.getCollection<Log>(tenantID, 'logs')
      .deleteMany(filters);
    // Return the result
    return result.result;
  }

  public static async deleteSecurityLogs(tenantID, deleteUpToDate) {
    // Check Tenant
    await Utils.checkTenant(tenantID);
    // Build filter
    const filters: any = {};
    // Delete Only Security Logs
    filters.type = {};
    filters.type.$eq = 'S';
    // Date provided?
    if (deleteUpToDate) {
      filters.timestamp = {};
      filters.timestamp.$lte = Utils.convertToDate(deleteUpToDate);
    } else {
      return;
    }
    // Delete Logs
    const result = await global.database.getCollection<Log>(tenantID, 'logs')
      .deleteMany(filters);
    // Return the result
    return result.result;
  }

  public static async saveLog(tenantID, logToSave: Log) {
    // Check Tenant
    await Utils.checkTenant(tenantID);
    // Set
    const logMDB: any = {
      userID: logToSave.user ? Utils.convertUserToObjectID(logToSave.user) : null,
      actionOnUserID: Utils.convertUserToObjectID(logToSave.actionOnUser),
      level: logToSave.level,
      source: logToSave.source,
      host: logToSave.host ? logToSave.host : (Configuration.isCloudFoundry() ? cfenv.getAppEnv().name : os.hostname()),
      process: logToSave.process ? logToSave.process : (cluster.isWorker ? 'worker ' + cluster.worker.id : 'master'),
      type: logToSave.type,
      timestamp: Utils.convertToDate(logToSave.timestamp),
      module: logToSave.module,
      method: logToSave.method,
      action: logToSave.action,
      message: logToSave.message,
      detailedMessages: logToSave.detailedMessages
    };
    // Insert
    await global.database.getCollection<Log>(tenantID, 'logs').insertOne(logMDB);
  }

  public static async getLog(tenantID: string, id: string = Constants.UNKNOWN_OBJECT_ID): Promise<Log> {
    // Debug
    const uniqueTimerID = Logging.traceStart(MODULE_NAME, 'getLog');
    // Query single Site
    const logsMDB = await LoggingStorage.getLogs(tenantID,
      { logID: id },
      Constants.DB_PARAMS_SINGLE_RECORD);
    // Debug
    Logging.traceEnd(MODULE_NAME, 'getLog', uniqueTimerID, { id });
    return logsMDB.count > 0 ? logsMDB.result[0] : null;
  }

  public static async getLogs(tenantID: string, params: {
    startDateTime?: Date; endDateTime?: Date; levels?: string[]; sources?: string[]; type?: string; actions?: string[];
    hosts?: string[]; userIDs?: string[]; search?: string; logID?: string;
  } = {}, dbParams: DbParams) {
    // Check Tenant
    await Utils.checkTenant(tenantID);
    // Check Limit
    dbParams.limit = Utils.checkRecordLimit(dbParams.limit);
    // Check Skip
    dbParams.skip = Utils.checkRecordSkip(dbParams.skip);
    // Set the filters
    const filters: any = {};
    // Date provided?
    if (params.startDateTime || params.endDateTime) {
      filters.timestamp = {};
    }
    // Start date
    if (params.startDateTime) {
      filters.timestamp.$gte = Utils.convertToDate(params.startDateTime);
    }
    // End date
    if (params.endDateTime) {
      filters.timestamp.$lte = Utils.convertToDate(params.endDateTime);
    }
    // Filter on log levels
    if (params.levels && params.levels.length > 0) {
      filters.level = { $in: params.levels };
    }
    // Filter on charging Stations
    if (params.sources && params.sources.length > 0) {
      filters.source = { $in: params.sources };
    }
    // Type
    if (params.type) {
      filters.type = params.type;
    }
    // Filter on actions
    if (params.actions && params.actions.length > 0) {
      filters.action = { $in: params.actions };
    }
    // Filter on host
    if (params.hosts && params.hosts.length > 0) {
      filters.host = { $in: params.hosts };
    }
    // Filter on users
    if (params.userIDs && params.userIDs.length > 0) {
      filters.$or = [
        { userID: { $in: params.userIDs.map((user) => Utils.convertToObjectID(user)) } },
        { actionOnUserID: { $in: params.userIDs.map((user) => Utils.convertToObjectID(user)) } }
      ];
    }
    // Search
    if (params.logID) {
      filters._id = Utils.convertToObjectID(params.logID);
    } else if (params.search) {
      // Set
      const searchArray = [
        { 'source': { $regex: params.search, $options: 'i' } },
        { 'host': { $regex: params.search, $options: 'i' } },
        { 'message': { $regex: params.search, $options: 'i' } },
        { 'detailedMessages': { $regex: params.search, $options: 'i' } },
        { 'action': { $regex: params.search, $options: 'i' } }
      ];
      // Already exists?
      if (filters.$or) {
        // Add them all
        filters.$and = [
          { $or: [...filters.$or] },
          { $or: [...searchArray] },
        ];
      } else {
        // Only one
        filters.$or = searchArray;
      }
    }
    // Create Aggregation
    const aggregation = [];
    // Filters
    if (filters) {
      aggregation.push({
        $match: filters
      });
    }
    // Count Records
    if (!dbParams.onlyRecordCount) {
      // Always limit the nbr of record to avoid perfs issues
      aggregation.push({ $limit: Constants.DB_RECORD_COUNT_CEIL });
    }
    const loggingsCountMDB = await global.database.getCollection<any>(tenantID, 'logs')
      .aggregate([...aggregation, { $count: 'count' }], {
        collation: {
          locale: Constants.DEFAULT_LOCALE,
          strength: 2
        }
      })
      .toArray();
    // Check if only the total count is requested
    if (dbParams.onlyRecordCount) {
      // Return only the count
      return {
        count: (loggingsCountMDB.length > 0 ? loggingsCountMDB[0].count : 0),
        result: []
      };
    }
    // Remove the limit
    aggregation.pop();
    // Sort
    if (dbParams.sort) {
      aggregation.push({
        $sort: dbParams.sort
      });
    } else {
      aggregation.push({
        $sort: { timestamp: -1 }
      });
    }
    // Skip
    aggregation.push({
      $skip: dbParams.skip
    });
    // Limit
    aggregation.push({
      $limit: dbParams.limit
    });
    // Add Users
    DatabaseUtils.pushUserLookupInAggregation({
      tenantID,
      aggregation: aggregation,
      asField: 'user',
      localField: 'userID',
      foreignField: '_id',
      oneToOneCardinality: true,
      oneToOneCardinalityNotNull: false
    });
    DatabaseUtils.pushUserLookupInAggregation({
      tenantID,
      aggregation: aggregation,
      asField: 'actionOnUser',
      localField: 'actionOnUserID',
      foreignField: '_id',
      oneToOneCardinality: true,
      oneToOneCardinalityNotNull: false
    });
    // Read DB
    const loggingsMDB = await global.database.getCollection<any>(tenantID, 'logs')
      .aggregate(aggregation, { allowDiskUse: true })
      .toArray();
    const loggings = [];
    for (const loggingMDB of loggingsMDB) {
      const logging: Log = {
        tenantID: tenantID,
        id: loggingMDB._id.toString(),
        level: loggingMDB.level,
        source: loggingMDB.source,
        host: loggingMDB.host,
        process: loggingMDB.process,
        module: loggingMDB.module,
        method: loggingMDB.method,
        timestamp: loggingMDB.timestamp,
        action: loggingMDB.action,
        type: loggingMDB.type,
        message: loggingMDB.message,
        user: loggingMDB.user,
        actionOnUser: loggingMDB.actionOnUser,
        detailedMessages: loggingMDB.detailedMessages
      };
      // Set the model
      loggings.push(logging);
    }
    // Ok
    return {
      count: (loggingsCountMDB.length > 0 ?
        (loggingsCountMDB[0].count === Constants.DB_RECORD_COUNT_CEIL ? -1 : loggingsCountMDB[0].count) : 0),
      result: loggings
    };
  }
}
