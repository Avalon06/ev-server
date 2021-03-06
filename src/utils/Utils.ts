import { Car, UserCar } from '../types/Car';
import { ChargePointStatus, OCPPProtocol, OCPPVersion } from '../types/ocpp/OCPPServer';
import ChargingStation, { ConnectorCurrentType, StaticLimitAmps } from '../types/ChargingStation';
import User, { UserRole, UserStatus } from '../types/User';

import { ActionsResponse } from '../types/GlobalType';
import AppError from '../exception/AppError';
import Asset from '../types/Asset';
import Authorizations from '../authorization/Authorizations';
import BackendError from '../exception/BackendError';
import { ChargingProfile } from '../types/ChargingProfile';
import Company from '../types/Company';
import Configuration from './Configuration';
import ConnectorStats from '../types/ConnectorStats';
import Constants from './Constants';
import Cypher from './Cypher';
import { HTTPError } from '../types/HTTPError';
import { InactivityStatus } from '../types/Transaction';
import Logging from './Logging';
import OCPIEndpoint from '../types/ocpi/OCPIEndpoint';
import { ObjectID } from 'mongodb';
import { Request } from 'express';
import { ServerAction } from '../types/Server';
import { SettingDBContent } from '../types/Setting';
import Site from '../types/Site';
import SiteArea from '../types/SiteArea';
import Tag from '../types/Tag';
import Tenant from '../types/Tenant';
import TenantComponents from '../types/TenantComponents';
import TenantStorage from '../storage/mongodb/TenantStorage';
import UserStorage from '../storage/mongodb/UserStorage';
import UserToken from '../types/UserToken';
import _ from 'lodash';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import moment from 'moment';
import passwordGenerator from 'password-generator';
import path from 'path';
import tzlookup from 'tz-lookup';
import url from 'url';
import uuidV4 from 'uuid/v4';
import validator from 'validator';

const _centralSystemFrontEndConfig = Configuration.getCentralSystemFrontEndConfig();
const _tenants = [];
const MODULE_NAME = 'Utils';

export default class Utils {
  public static getEndOfChargeNotificationIntervalMins(chargingStation: ChargingStation, connectorId: number) {
    let intervalMins = 0;
    if (!chargingStation || !chargingStation.connectors) {
      return 0;
    }
    const connector = chargingStation.connectors[connectorId - 1];
    if (connector.power <= 3680) {
      // Notify every 120 mins
      intervalMins = 120;
    } else if (connector.power <= 7360) {
      // Notify every 60 mins
      intervalMins = 60;
    } else if (connector.power < 50000) {
      // Notify every 30 mins
      intervalMins = 30;
    } else if (connector.power >= 50000) {
      // Notify every 15 mins
      intervalMins = 15;
    }
    return intervalMins;
  }

  public static logActionsResponse(
    tenantID: string, action: ServerAction, module: string, method: string, actionsResponse: ActionsResponse,
    messageSuccess: string, messageError: string, messageSuccessAndError: string,
    messageNoSuccessNoError: string) {
    // Replace
    messageSuccess = messageSuccess.replace('{{inSuccess}}', actionsResponse.inSuccess.toString());
    messageError = messageError.replace('{{inError}}', actionsResponse.inError.toString());
    messageSuccessAndError = messageSuccessAndError.replace('{{inSuccess}}', actionsResponse.inSuccess.toString());
    messageSuccessAndError = messageSuccessAndError.replace('{{inError}}', actionsResponse.inError.toString());
    // Success and Error
    if (actionsResponse.inSuccess > 0 && actionsResponse.inError > 0) {
      Logging.logError({
        tenantID: tenantID,
        source: Constants.CENTRAL_SERVER,
        action, module, method,
        message: messageSuccessAndError
      });
    } else if (actionsResponse.inSuccess > 0) {
      Logging.logInfo({
        tenantID: tenantID,
        source: Constants.CENTRAL_SERVER,
        action, module, method,
        message: messageSuccess
      });
    } else if (actionsResponse.inError > 0) {
      Logging.logError({
        tenantID: tenantID,
        source: Constants.CENTRAL_SERVER,
        action, module, method,
        message: messageError
      });
    } else {
      Logging.logInfo({
        tenantID: tenantID,
        source: Constants.CENTRAL_SERVER,
        action, module, method,
        message: messageNoSuccessNoError
      });
    }
  }

  public static getInactivityStatusLevel(chargingStation: ChargingStation, connectorId: number, inactivitySecs: number): InactivityStatus {
    if (!inactivitySecs) {
      return InactivityStatus.INFO;
    }
    // Get Notification Interval
    const intervalMins = Utils.getEndOfChargeNotificationIntervalMins(chargingStation, connectorId);
    // Check
    if (inactivitySecs < (intervalMins * 60)) {
      return InactivityStatus.INFO;
    } else if (inactivitySecs < (intervalMins * 60 * 2)) {
      return InactivityStatus.WARNING;
    }
    return InactivityStatus.ERROR;
  }

  public static objectHasProperty(object: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  public static generateGUID() {
    return uuidV4();
  }

  static generateTagID(name, firstName) {
    let tagID = '';
    if (name && name.length > 0) {
      tagID = name[0].toUpperCase();
    } else {
      tagID = 'S';
    }
    if (firstName && firstName.length > 0) {
      tagID += firstName[0].toUpperCase();
    } else {
      tagID += 'F';
    }
    tagID += Math.floor((Math.random() * 2147483648) + 1);
    return tagID;
  }

  public static isIterable(obj): boolean {
    if (obj) {
      return typeof obj[Symbol.iterator] === 'function';
    }
    return false;
  }

  public static getConnectorStatusesFromChargingStations(chargingStations: ChargingStation[]): ConnectorStats {
    const connectorStats: ConnectorStats = {
      totalChargers: 0,
      availableChargers: 0,
      totalConnectors: 0,
      chargingConnectors: 0,
      suspendedConnectors: 0,
      availableConnectors: 0,
      unavailableConnectors: 0,
      preparingConnectors: 0,
      finishingConnectors: 0,
      faultedConnectors: 0
    };
    // Chargers
    for (const chargingStation of chargingStations) {
      // Check not deleted
      if (chargingStation.deleted) {
        continue;
      }
      // Check connectors
      Utils.checkAndUpdateConnectorsStatus(chargingStation);
      connectorStats.totalChargers++;
      // Handle Connectors
      if (!chargingStation.connectors) {
        chargingStation.connectors = [];
      }
      for (const connector of chargingStation.connectors) {
        if (!connector) {
          continue;
        }
        connectorStats.totalConnectors++;
        // Not Available?
        if (chargingStation.inactive ||
          connector.status === ChargePointStatus.UNAVAILABLE) {
          connectorStats.unavailableConnectors++;
          // Available?
        } else if (connector.status === ChargePointStatus.AVAILABLE) {
          connectorStats.availableConnectors++;
          // Suspended?
        } else if (connector.status === ChargePointStatus.SUSPENDED_EV ||
          connector.status === ChargePointStatus.SUSPENDED_EVSE) {
          connectorStats.suspendedConnectors++;
          // Charging?
        } else if (connector.status === ChargePointStatus.CHARGING ||
          connector.status === ChargePointStatus.OCCUPIED) {
          connectorStats.chargingConnectors++;
          // Faulted?
        } else if (connector.status === ChargePointStatus.FAULTED) {
          connectorStats.faultedConnectors++;
          // Preparing?
        } else if (connector.status === ChargePointStatus.PREPARING) {
          connectorStats.preparingConnectors++;
          // Finishing?
        } else if (connector.status === ChargePointStatus.FINISHING) {
          connectorStats.finishingConnectors++;
        }
      }
      // Handle Chargers
      for (const connector of chargingStation.connectors) {
        if (!connector) {
          continue;
        }
        // Check if Available
        if (!chargingStation.inactive && connector.status === ChargePointStatus.AVAILABLE) {
          connectorStats.availableChargers++;
          break;
        }
      }
    }
    return connectorStats;
  }

  public static getChargingStationHeartbeatMaxIntervalSecs(): number {
    // Get Heartbeat Interval from conf
    const config = Configuration.getChargingStationConfig();
    return config.heartbeatIntervalSecs * 3;
  }

  public static checkAndUpdateConnectorsStatus(chargingStation: ChargingStation) {
    // Cannot charge in //
    if (chargingStation.cannotChargeInParallel) {
      let lockAllConnectors = false;
      // Check
      for (const connector of chargingStation.connectors) {
        if (!connector) {
          continue;
        }
        if (connector.status !== ChargePointStatus.AVAILABLE) {
          lockAllConnectors = true;
          break;
        }
      }
      // Lock?
      if (lockAllConnectors) {
        for (const connector of chargingStation.connectors) {
          if (!connector) {
            continue;
          }
          if (connector.status === ChargePointStatus.AVAILABLE) {
            // Check OCPP Version
            if (chargingStation.ocppVersion === OCPPVersion.VERSION_15) {
              // Set OCPP 1.5 Occupied
              connector.status = ChargePointStatus.OCCUPIED;
            } else {
              // Set OCPP 1.6 Unavailable
              connector.status = ChargePointStatus.UNAVAILABLE;
            }
          }
        }
      }
    }
  }

  public static getLanguageFromLocale(locale: string) {
    let language = Constants.DEFAULT_LANGUAGE;
    // Set the User's locale
    if (locale && locale.length > 2) {
      language = locale.substring(0, 2);
    }
    return language;
  }

  public static async normalizeAndCheckSOAPParams(headers, req) {
    // Normalize
    Utils._normalizeOneSOAPParam(headers, 'chargeBoxIdentity');
    Utils._normalizeOneSOAPParam(headers, 'Action');
    Utils._normalizeOneSOAPParam(headers, 'To');
    Utils._normalizeOneSOAPParam(headers, 'From.Address');
    Utils._normalizeOneSOAPParam(headers, 'ReplyTo.Address');
    // Parse the request (lower case for fucking charging station DBT URL registration)
    const urlParts = url.parse(decodeURIComponent(req.url.toLowerCase()), true);
    const tenantID = urlParts.query.tenantid as string;
    const token = urlParts.query.token;
    // Check
    await Utils.checkTenant(tenantID);
    // Set the Tenant ID
    headers.tenantID = tenantID;
    headers.token = token;

    if (!Utils.isChargingStationIDValid(headers.chargeBoxIdentity)) {
      throw new BackendError({
        source: headers.chargeBoxIdentity,
        module: MODULE_NAME,
        method: 'normalizeAndCheckSOAPParams',
        message: 'The Charging Station ID is invalid'
      });
    }
  }

  public static _normalizeOneSOAPParam(headers, name) {
    const val = _.get(headers, name);
    if (val && val.$value) {
      _.set(headers, name, val.$value);
    }
  }

  public static async checkTenant(tenantID: string): Promise<void> {
    if (!tenantID) {
      throw new BackendError({
        source: Constants.CENTRAL_SERVER,
        module: MODULE_NAME,
        method: 'checkTenant',
        message: 'The Tenant ID is mandatory'
      });
    }
    // Check in cache
    if (_tenants.includes(tenantID)) {
      return Promise.resolve(null);
    }
    if (tenantID !== Constants.DEFAULT_TENANT) {
      // Valid Object ID?
      if (!ObjectID.isValid(tenantID)) {
        throw new BackendError({
          source: Constants.CENTRAL_SERVER,
          module: MODULE_NAME,
          method: 'checkTenant',
          message: `Invalid Tenant ID '${tenantID}'`
        });
      }
      // Get the Tenant
      const tenant = await TenantStorage.getTenant(tenantID);
      if (!tenant) {
        throw new BackendError({
          source: Constants.CENTRAL_SERVER,
          module: MODULE_NAME,
          method: 'checkTenant',
          message: `Invalid Tenant ID '${tenantID}'`
        });
      }
    }
    _tenants.push(tenantID);
  }

  static convertToBoolean(value: any): boolean {
    let result = false;
    // Check boolean
    if (value) {
      // Check the type
      if (typeof value === 'boolean') {
        // Already a boolean
        result = value;
      } else {
        // Convert
        result = (value === 'true');
      }
    }
    return result;
  }

  public static convertToDate(date: any): Date {
    // Check
    if (!date) {
      return date;
    }
    // Check Type
    if (!(date instanceof Date)) {
      return new Date(date);
    }
    return date;
  }

  public static replaceSpecialCharsInCSVValueParam(value: string): string {
    return value ? value.replace(/\n/g, '') : '';
  }

  public static escapeSpecialCharsInRegex(value: string): string {
    return value ? value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
  }

  public static isEmptyJSon(document) {
    // Empty?
    if (!document) {
      return true;
    }
    // Check type
    if (typeof document !== 'object') {
      return true;
    }
    // Check
    return Object.keys(document).length === 0;
  }

  public static removeExtraEmptyLines(tab) {
    // Start from the end
    for (let i = tab.length - 1; i > 0; i--) {
      // Two consecutive empty lines?
      if (tab[i].length === 0 && tab[i - 1].length === 0) {
        // Remove the last one
        tab.splice(i, 1);
      }
      // Check last line
      if (i === 1 && tab[i - 1].length === 0) {
        // Remove the first one
        tab.splice(i - 1, 1);
      }
    }
  }

  public static isComponentActiveFromToken(userToken: UserToken, componentName: TenantComponents): boolean {
    return userToken.activeComponents.includes(componentName);
  }

  public static convertToObjectID(id: any): ObjectID {
    let changedID = id;
    // Check
    if (typeof id === 'string') {
      // Create Object
      changedID = new ObjectID(id);
    }
    return changedID;
  }

  public static convertToInt(value: any): number {
    let changedValue = value;
    if (!value) {
      return 0;
    }
    // Check
    if (typeof value === 'string') {
      // Create Object
      changedValue = parseInt(value);
    }
    return changedValue;
  }

  public static convertToFloat(value: any): number {
    let changedValue = value;
    if (!value) {
      return 0;
    }
    // Check
    if (typeof value === 'string') {
      // Create Object
      changedValue = parseFloat(value);
    }
    return changedValue;
  }

  public static convertUserToObjectID(user: User|UserToken|string): ObjectID | null {
    let userID = null;
    // Check Created By
    if (user) {
      // Check User Model
      if (typeof user === 'object' &&
        user.constructor.name !== 'ObjectID') {
        // This is the User Model
        userID = Utils.convertToObjectID(user.id);
      }
      // Check String
      if (typeof user === 'string') {
        // This is a String
        userID = Utils.convertToObjectID(user);
      }
    }
    return userID;
  }

  public static convertAmpToPowerWatts(chargingStation: ChargingStation, connectorID: number, ampValue: number): number {
    // AC Chargers?
    if (chargingStation &&
        chargingStation.connectors && chargingStation.connectors.length > 0 &&
        chargingStation.connectors[connectorID - 1].currentType === ConnectorCurrentType.AC,chargingStation.connectors[connectorID - 1].numberOfConnectedPhase) {
      return this.convertAmpToWatt(chargingStation.connectors[connectorID - 1].numberOfConnectedPhase, ampValue);
    }
    return 0;
  }

  public static getTotalAmpsOfChargingStation(chargingStation: ChargingStation): number {
    let totalAmps = 0;
    for (const connector of chargingStation.connectors) {
      totalAmps += connector.amperageLimit;
    }
    return totalAmps;
  }

  public static convertAmpToWatt(numberOfConnectedPhase: number, maxIntensityInAmper: number): number {
    // Compute it
    if (numberOfConnectedPhase === 0) {
      return Math.floor(230 * maxIntensityInAmper * 3);
    }
    if (numberOfConnectedPhase === 3) {
      return Math.floor(230 * maxIntensityInAmper * 3);
    }
    return Math.floor(230 * maxIntensityInAmper);
  }

  public static convertWattToAmp(numberOfConnectedPhase: number, maxIntensityInWatt: number): number {
    // Compute it
    if (numberOfConnectedPhase === 0) {
      return Math.floor(maxIntensityInWatt / 230 / 3);
    }
    if (numberOfConnectedPhase === 3) {
      return Math.floor(maxIntensityInWatt / 230 / 3);
    }
    return Math.floor(maxIntensityInWatt / 230);
  }

  public static isEmptyArray(array): boolean {
    if (Array.isArray(array) && array.length > 0) {
      return false;
    }
    return true;
  }

  public static buildUserFullName(user: User, withID = true, withEmail = false, invertedName = false) {
    let fullName: string;
    if (!user || !user.name) {
      return 'Unknown';
    }
    if (invertedName) {
      if (user.firstName) {
        fullName = `${user.name}, ${user.firstName}`;
      } else {
        fullName = user.name;
      }
    } else {
      // eslint-disable-next-line no-lonely-if
      if (user.firstName) {
        fullName = `${user.firstName} ${user.name}`;
      } else {
        fullName = user.name;
      }
    }
    if (withID && user.iNumber) {
      fullName += ` (${user.iNumber})`;
    }
    if (withEmail && user.email) {
      fullName += `; ${user.email}`;
    }
    return fullName;
  }

  // Save the users in file
  public static saveFile(filename, content) {
    // Save
    fs.writeFileSync(path.join(__dirname, filename), content, 'UTF-8');
  }

  public static getRandomInt(): number {
    return Math.floor((Math.random() * 2147483648) + 1); // INT32 (signed: issue in Schneider)
  }

  public static buildEvseURL(subdomain: string = null): string {
    if (subdomain) {
      return `${_centralSystemFrontEndConfig.protocol}://${subdomain}.${_centralSystemFrontEndConfig.host}:${_centralSystemFrontEndConfig.port}`;
    }
    return `${_centralSystemFrontEndConfig.protocol}://${_centralSystemFrontEndConfig.host}:${
      _centralSystemFrontEndConfig.port}`;
  }

  public static buildOCPPServerURL(tenantID: string, ocppVersion: OCPPVersion, ocppProtocol: OCPPProtocol, token?: string): string {
    let ocppUrl;
    const version = ocppVersion === OCPPVersion.VERSION_16 ? 'OCPP16' : 'OCPP15';
    switch (ocppProtocol) {
      case OCPPProtocol.JSON:
        ocppUrl = `${Configuration.getJsonEndpointConfig().baseUrl}/OCPP16/${tenantID}`;
        if (token) {
          ocppUrl += `/${token}`;
        }
        return ocppUrl;
      case OCPPProtocol.SOAP:
      default:
        ocppUrl = `${Configuration.getWSDLEndpointConfig().baseUrl}/${version}?TenantID=${tenantID}`;
        if (token) {
          ocppUrl += `%26Token=${token}`;
        }
        return ocppUrl;
    }
  }

  public static async buildEvseUserURL(tenantID: string, user: User, hash = ''): Promise<string> {
    const tenant = await TenantStorage.getTenant(tenantID);
    const _evseBaseURL = Utils.buildEvseURL(tenant.subdomain);
    // Add
    return _evseBaseURL + '/users?UserID=' + user.id + hash;
  }

  public static async buildEvseChargingStationURL(tenantID: string, chargingStation: ChargingStation, hash = ''): Promise<string> {
    const tenant = await TenantStorage.getTenant(tenantID);
    const _evseBaseURL = Utils.buildEvseURL(tenant.subdomain);
    return _evseBaseURL + '/charging-stations?ChargingStationID=' + chargingStation.id + hash;
  }

  public static async buildEvseTransactionURL(tenantID: string, chargingStation: ChargingStation, transactionId, hash = ''): Promise<string> {
    const tenant = await TenantStorage.getTenant(tenantID);
    const _evseBaseURL = Utils.buildEvseURL(tenant.subdomain);
    return _evseBaseURL + '/transactions?TransactionID=' + transactionId + hash;
  }

  public static async buildEvseBillingSettingsURL(tenantID: string): Promise<string> {
    const tenant = await TenantStorage.getTenant(tenantID);
    const _evseBaseURL = Utils.buildEvseURL(tenant.subdomain);
    return _evseBaseURL + '/settings#billing';
  }

  public static isServerInProductionMode(): boolean {
    const env = process.env.NODE_ENV || 'dev';
    return (env === 'production');
  }

  public static hideShowMessage(message): string {
    // Check Prod
    if (Utils.isServerInProductionMode()) {
      return 'An unexpected server error occurred. Check the server\'s logs!';
    }
    return message;
  }

  public static getRequestIP(request): string {
    if (request.ip) {
      return request.ip;
    } else if (request.headers['x-forwarded-for']) {
      return request.headers['x-forwarded-for'];
    } else if (request.connection.remoteAddress) {
      return request.connection.remoteAddress;
    } else if (request.headers.host) {
      const host = request.headers.host.split(':', 2);
      const ip = host[0];
      return ip;
    }
  }

  public static checkRecordLimit(recordLimit: number | string): number {
    // String?
    if (typeof recordLimit === 'string') {
      recordLimit = Utils.convertToInt(recordLimit);
    }
    // Not provided?
    if (isNaN(recordLimit) || recordLimit < 0 || recordLimit === 0) {
      recordLimit = Constants.DB_RECORD_COUNT_DEFAULT;
    }
    // Check max
    if (recordLimit > Number.MAX_SAFE_INTEGER) {
      recordLimit = Number.MAX_SAFE_INTEGER;
    }
    return recordLimit;
  }

  public static roundTo(number, scale) {
    return Utils.convertToFloat(number.toFixed(scale));
  }

  public static firstLetterInUpperCase(value: string): string {
    return value[0].toUpperCase() + value.substring(1);
  }

  public static firstLetterInLowerCase(value: string): string {
    return value[0].toLowerCase() + value.substring(1);
  }

  public static cloneJSonDocument(jsonDocument: object): object {
    return JSON.parse(JSON.stringify(jsonDocument));
  }

  public static getConnectorLetterFromConnectorID(connectorID: number): string {
    return String.fromCharCode(65 + connectorID - 1);
  }

  public static getConnectorIDFromConnectorLetter(connectorLetter: string): number {
    return connectorLetter.charCodeAt(0) - 64;
  }

  public static checkRecordSkip(recordSkip: number | string): number {
    // String?
    if (typeof recordSkip === 'string') {
      recordSkip = Utils.convertToInt(recordSkip);
    }
    // Not provided?
    if (isNaN(recordSkip) || recordSkip < 0) {
      // Default
      recordSkip = 0;
    }
    return recordSkip;
  }

  public static generateToken(email) {
    return Cypher.hash(`${new Date().toISOString()}~${email}`);
  }

  public static duplicateJSON(src): any {
    if (!src || typeof src !== 'object') {
      return src;
    }
    // Recreate all of it
    return JSON.parse(JSON.stringify(src));
  }

  public static getRoleNameFromRoleID(roleID) {
    switch (roleID) {
      case UserRole.BASIC:
        return 'Basic';
      case UserRole.DEMO:
        return 'Demo';
      case UserRole.ADMIN:
        return 'Admin';
      case UserRole.SUPER_ADMIN:
        return 'Super Admin';
      default:
        return 'Unknown';
    }
  }

  public static async hashPasswordBcrypt(password: string): Promise<string> {
    // eslint-disable-next-line no-undef
    return await new Promise((fulfill, reject) => {
      // Generate a salt with 15 rounds
      bcrypt.genSalt(10, (error, salt) => {
        // Hash
        bcrypt.hash(password, salt, (err, hash) => {
          // Error?
          if (err) {
            reject(err);
          } else {
            fulfill(hash);
          }
        });
      });
    });
  }

  public static async checkPasswordBCrypt(password, hash): Promise<boolean> {
    // eslint-disable-next-line no-undef
    return await new Promise((fulfill, reject) => {
      // Compare
      bcrypt.compare(password, hash, (err, match) => {
        // Error?
        if (err) {
          reject(err);
        } else {
          fulfill(match);
        }
      });
    });
  }

  public static isPasswordStrongEnough(password) {
    const uc = password.match(Constants.PWD_UPPERCASE_RE);
    const lc = password.match(Constants.PWD_LOWERCASE_RE);
    const n = password.match(Constants.PWD_NUMBER_RE);
    const sc = password.match(Constants.PWD_SPECIAL_CHAR_RE);
    return password.length >= Constants.PWD_MIN_LENGTH &&
      uc && uc.length >= Constants.PWD_UPPERCASE_MIN_COUNT &&
      lc && lc.length >= Constants.PWD_LOWERCASE_MIN_COUNT &&
      n && n.length >= Constants.PWD_NUMBER_MIN_COUNT &&
      sc && sc.length >= Constants.PWD_SPECIAL_MIN_COUNT;
  }


  public static generatePassword() {
    let password = '';
    const randomLength = Math.floor(Math.random() * (Constants.PWD_MAX_LENGTH - Constants.PWD_MIN_LENGTH)) + Constants.PWD_MIN_LENGTH;
    while (!Utils.isPasswordStrongEnough(password)) {
      // eslint-disable-next-line no-useless-escape
      password = passwordGenerator(randomLength, false, /[\w\d!#\$%\^&\*\.\?\-]/);
    }
    return password;
  }

  public static getStatusDescription(status: string): string {
    switch (status) {
      case UserStatus.PENDING:
        return 'Pending';
      case UserStatus.LOCKED:
        return 'Locked';
      case UserStatus.BLOCKED:
        return 'Blocked';
      case UserStatus.ACTIVE:
        return 'Active';
      case UserStatus.INACTIVE:
        return 'Inactive';
      default:
        return 'Unknown';
    }
  }

  public static hashPassword(password) {
    return Cypher.hash(password);
  }

  public static checkIfOCPIEndpointValid(ocpiEndpoint: Partial<OCPIEndpoint>, req: Request): void {
    if (req.method !== 'POST' && !ocpiEndpoint.id) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'The OCPI Endpoint ID is mandatory',
        module: MODULE_NAME,
        method: 'checkIfOCPIEndpointValid'
      });
    }
    if (!ocpiEndpoint.name) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'The OCPI Endpoint name is mandatory',
        module: MODULE_NAME,
        method: 'checkIfOCPIEndpointValid',
        user: req.user.id
      });
    }
    if (!ocpiEndpoint.role) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'The OCPI Endpoint role is mandatory',
        module: MODULE_NAME,
        method: 'checkIfOCPIEndpointValid',
        user: req.user.id
      });
    }
    if (!ocpiEndpoint.baseUrl) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'The OCPI Endpoint base URL is mandatory',
        module: MODULE_NAME,
        method: 'checkIfOCPIEndpointValid',
        user: req.user.id
      });
    }
    if (!ocpiEndpoint.localToken) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'The OCPI Endpoint local token is mandatory',
        module: MODULE_NAME,
        method: 'checkIfOCPIEndpointValid',
        user: req.user.id
      });
    }
    if (!ocpiEndpoint.token) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'The OCPI Endpoint token is mandatory',
        module: MODULE_NAME,
        method: 'checkIfOCPIEndpointValid',
        user: req.user.id
      });
    }
  }

  public static checkIfChargingProfileIsValid(filteredRequest: ChargingProfile, req: Request): void {
    if (!filteredRequest.profile) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        action: ServerAction.CHARGING_PROFILE_UPDATE,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Charging Profile is mandatory',
        module: MODULE_NAME, method: 'checkIfChargingProfileIsValid',
        user: req.user.id
      });
    }
    if (!filteredRequest.profile.chargingProfileId || !filteredRequest.profile.stackLevel ||
        !filteredRequest.profile.chargingProfilePurpose || !filteredRequest.profile.chargingProfileKind ||
        !filteredRequest.profile.chargingSchedule) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        action: ServerAction.CHARGING_PROFILE_UPDATE,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Invalid Charging Profile',
        module: MODULE_NAME, method: 'checkIfChargingProfileIsValid',
        user: req.user.id
      });
    }
    if (!filteredRequest.profile.chargingSchedule.chargingSchedulePeriod) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        action: ServerAction.CHARGING_PROFILE_UPDATE,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Invalid Charging Profile\'s Schedule',
        module: MODULE_NAME, method: 'checkIfChargingProfileIsValid',
        user: req.user.id
      });
    }
    if (filteredRequest.profile.chargingSchedule.chargingSchedulePeriod.length === 0) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        action: ServerAction.CHARGING_PROFILE_UPDATE,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Charging Profile\'s schedule must not be empty',
        module: MODULE_NAME, method: 'checkIfChargingProfileIsValid',
        user: req.user.id
      });
    }
    // pragma if (new Date(filteredRequest.profile.chargingSchedule.startSchedule).getTime() < new Date().getTime()) {
    //   throw new AppError({
    //     source: Constants.CENTRAL_SERVER,
    //     action: ServerAction.CHARGING_PROFILE_UPDATE,
    //     errorCode: HTTPError.GENERAL_ERROR,
    //     message: 'Charging Profile\'s start date must not be in the past',
    //     module: MODULE_NAME, method: 'checkIfChargingProfileIsValid',
    //     user: req.user.id
    //   });
    // }
    // Check End of Schedule <= 24h
    const endScheduleDate = new Date(new Date(filteredRequest.profile.chargingSchedule.startSchedule).getTime() +
      filteredRequest.profile.chargingSchedule.duration * 1000);
    if (!moment(endScheduleDate).isBefore(moment(filteredRequest.profile.chargingSchedule.startSchedule).add('1', 'd').add('1', 'm'))) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        action: ServerAction.CHARGING_PROFILE_UPDATE,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Charging Profile\'s schedule should not exeed 24 hours',
        module: MODULE_NAME, method: 'checkIfChargingProfileIsValid',
        user: req.user.id
      });
    }
    // Check Min Limitation of each Schedule
    for (const chargingSchedulePeriod of filteredRequest.profile.chargingSchedule.chargingSchedulePeriod) {
      if (chargingSchedulePeriod.limit < StaticLimitAmps.MIN_LIMIT) {
        throw new AppError({
          source: Constants.CENTRAL_SERVER,
          action: ServerAction.CHARGING_PROFILE_UPDATE,
          errorCode: HTTPError.GENERAL_ERROR,
          message: `Charging Schedule is below the min limitation (${StaticLimitAmps.MIN_LIMIT}A)`,
          module: MODULE_NAME, method: 'checkIfChargingProfileIsValid',
          user: req.user.id,
          detailedMessages: { chargingSchedulePeriod }
        });
      }
    }
  }

  public static checkIfSiteValid(site: Partial<Site>, req: Request): void {
    if (req.method !== 'POST' && !site.id) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Site ID is mandatory',
        module: MODULE_NAME,
        method: '_checkIfSiteValid',
        user: req.user.id
      });
    }
    if (!site.name) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Site Name is mandatory',
        module: MODULE_NAME,
        method: '_checkIfSiteValid',
        user: req.user.id
      });
    }
    if (!site.companyID) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Company ID is mandatory for the Site',
        module: MODULE_NAME,
        method: '_checkIfSiteValid',
        user: req.user.id
      });
    }
  }

  public static checkIfSiteAreaValid(siteArea: Partial<SiteArea>, req: Request): void {
    if (req.method !== 'POST' && !siteArea.id) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Site Area ID is mandatory',
        module: MODULE_NAME,
        method: '_checkIfSiteAreaValid',
        user: req.user.id
      });
    }
    if (!siteArea.name) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Site Area name is mandatory',
        module: MODULE_NAME,
        method: '_checkIfSiteAreaValid',
        user: req.user.id
      });
    }
    if (!siteArea.siteID) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Site ID is mandatory',
        module: MODULE_NAME,
        method: '_checkIfSiteAreaValid',
        user: req.user.id
      });
    }
    // Smart Charging?
    if (Utils.isComponentActiveFromToken(req.user, TenantComponents.SMART_CHARGING) && siteArea.smartCharging) {
      if (siteArea.maximumPower <= 0) {
        throw new AppError({
          source: Constants.CENTRAL_SERVER,
          errorCode: HTTPError.GENERAL_ERROR,
          message: `Site maximum power must be a positive number but got ${siteArea.maximumPower} kW`,
          module: MODULE_NAME,
          method: '_checkIfSiteAreaValid',
          user: req.user.id
        });
      }
      if (siteArea.numberOfPhases !== 1 && siteArea.numberOfPhases !== 3) {
        throw new AppError({
          source: Constants.CENTRAL_SERVER,
          errorCode: HTTPError.GENERAL_ERROR,
          message: `Site area number of phases must be 1 or 3 but got ${siteArea.numberOfPhases}`,
          module: MODULE_NAME,
          method: '_checkIfSiteAreaValid',
          user: req.user.id
        });
      }
    }
  }

  public static checkIfCompanyValid(company: Partial<Company>, req: Request): void {
    if (req.method !== 'POST' && !company.id) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Company ID is mandatory',
        module: MODULE_NAME,
        method: 'checkIfCompanyValid',
        user: req.user.id
      });
    }
    if (!company.name) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Company Name is mandatory',
        module: MODULE_NAME,
        method: 'checkIfCompanyValid',
        user: req.user.id
      });
    }
  }

  public static isValidDate(date: any) {
    return moment(date).isValid();
  }

  public static checkIfAssetValid(asset: Partial<Asset>, req: Request): void {
    if (req.method !== 'POST' && !asset.id) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Asset ID is mandatory',
        module: MODULE_NAME,
        method: 'checkIfAssetValid',
        user: req.user.id
      });
    }
    if (!asset.name) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Asset Name is mandatory',
        module: MODULE_NAME,
        method: 'checkIfAssetValid',
        user: req.user.id
      });
    }
    if (!asset.siteAreaID) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Asset Site Area is mandatory',
        module: MODULE_NAME,
        method: 'checkIfAssetValid',
        user: req.user.id
      });
    }
    if (!asset.assetType) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Asset type is mandatory',
        module: MODULE_NAME,
        method: 'checkIfAssetValid',
        user: req.user.id
      });
    }
  }

  public static async checkIfUserTagsAreValid(user: User, tags: Tag[], req: Request) {
    // Check that the Badge ID is not already used
    if (Authorizations.isAdmin(req.user) || Authorizations.isSuperAdmin(req.user)) {
      if (tags) {
        for (const tag of tags) {
          const foundUser = await UserStorage.getUserByTagId(req.user.tenantID, tag.id);
          if (foundUser && (!user || (foundUser.id !== user.id))) {
            // Tag already used!
            throw new AppError({
              source: Constants.CENTRAL_SERVER,
              errorCode: HTTPError.USER_TAG_ID_ALREADY_USED_ERROR,
              message: `The Tag ID '${tag.id}' is already used by User '${Utils.buildUserFullName(foundUser)}'`,
              module: MODULE_NAME,
              method: 'checkIfUserTagsAreValid',
              user: req.user.id
            });
          }
        }
      }
    }
  }

  public static checkIfUserValid(filteredRequest: Partial<User>, user: User, req: Request) {
    const tenantID = req.user.tenantID;
    if (!tenantID) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Tenant is mandatory',
        module: MODULE_NAME,
        method: 'checkIfUserValid',
        user: req.user.id
      });
    }
    // Update model?
    if (req.method !== 'POST' && !filteredRequest.id) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'User ID is mandatory',
        module: MODULE_NAME,
        method: 'checkIfUserValid',
        user: req.user.id
      });
    }
    // Creation?
    if (req.method === 'POST') {
      if (!filteredRequest.role) {
        filteredRequest.role = UserRole.BASIC;
      }
    } else if (!Authorizations.isAdmin(req.user)) {
      filteredRequest.role = user.role;
    }
    if (req.method === 'POST' && !filteredRequest.status) {
      filteredRequest.status = UserStatus.BLOCKED;
    }
    // Creation?
    if ((filteredRequest.role !== UserRole.BASIC) && (filteredRequest.role !== UserRole.DEMO) &&
      !Authorizations.isAdmin(req.user) && !Authorizations.isSuperAdmin(req.user)) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: `Only Admins can assign the role '${Utils.getRoleNameFromRoleID(filteredRequest.role)}'`,
        module: MODULE_NAME,
        method: 'checkIfUserValid',
        user: req.user.id,
        actionOnUser: filteredRequest.id
      });
    }
    // Only Basic, Demo, Admin user other Tenants (!== default)
    if (tenantID !== 'default' && filteredRequest.role && filteredRequest.role === UserRole.SUPER_ADMIN) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'User cannot have the Super Admin role in this Tenant',
        module: MODULE_NAME,
        method: 'checkIfUserValid',
        user: req.user.id,
        actionOnUser: filteredRequest.id
      });
    }
    // Only Admin and Super Admin can use role different from Basic
    if ((filteredRequest.role === UserRole.ADMIN || filteredRequest.role === UserRole.SUPER_ADMIN) &&
      !Authorizations.isAdmin(req.user) && !Authorizations.isSuperAdmin(req.user)) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: `User without role Admin or Super Admin tried to ${filteredRequest.id ? 'update' : 'create'} an User with the '${Utils.getRoleNameFromRoleID(filteredRequest.role)}' role`,
        module: MODULE_NAME,
        method: 'checkIfUserValid',
        user: req.user.id,
        actionOnUser: filteredRequest.id
      });
    }
    if (!filteredRequest.name) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'User Last Name is mandatory',
        module: MODULE_NAME,
        method: 'checkIfUserValid',
        user: req.user.id,
        actionOnUser: filteredRequest.id
      });
    }
    if (req.method === 'POST' && !filteredRequest.email) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'User Email is mandatory',
        module: MODULE_NAME,
        method: 'checkIfUserValid',
        user: req.user.id,
        actionOnUser: filteredRequest.id
      });
    }
    if (req.method === 'POST' && !Utils._isUserEmailValid(filteredRequest.email)) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: `User Email ${filteredRequest.email} is not valid`,
        module: MODULE_NAME,
        method: 'checkIfUserValid',
        user: req.user.id,
        actionOnUser: filteredRequest.id
      });
    }
    if (filteredRequest.password && !Utils.isPasswordValid(filteredRequest.password)) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'User Password is not valid',
        module: MODULE_NAME,
        method: 'checkIfUserValid',
        user: req.user.id,
        actionOnUser: filteredRequest.id
      });
    }
    if (filteredRequest.phone && !Utils._isPhoneValid(filteredRequest.phone)) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: `User Phone ${filteredRequest.phone} is not valid`,
        module: MODULE_NAME,
        method: 'checkIfUserValid',
        user: req.user.id,
        actionOnUser: filteredRequest.id
      });
    }
    if (filteredRequest.mobile && !Utils._isPhoneValid(filteredRequest.mobile)) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: `User Mobile ${filteredRequest.mobile} is not valid`,
        module: MODULE_NAME,
        method: 'checkIfUserValid',
        user: req.user.id,
        actionOnUser: filteredRequest.id
      });
    }
    if (filteredRequest.tags) {
      if (!Utils._areTagsValid(filteredRequest.tags)) {
        throw new AppError({
          source: Constants.CENTRAL_SERVER,
          errorCode: HTTPError.GENERAL_ERROR,
          message: `User Tags ${filteredRequest.tags} is/are not valid`,
          module: MODULE_NAME,
          method: 'checkIfUserValid',
          user: req.user.id,
          actionOnUser: filteredRequest.id
        });
      }
    }
    if (filteredRequest.plateID && !Utils._isPlateIDValid(filteredRequest.plateID)) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: `User Plate ID ${filteredRequest.plateID} is not valid`,
        module: MODULE_NAME,
        method: 'checkIfUserValid',
        user: req.user.id,
        actionOnUser: filteredRequest.id
      });
    }
  }

  public static getTimezone(coordinates: number[]) {
    if (coordinates && coordinates.length === 2) {
      return tzlookup(coordinates[1], coordinates[0]);
    }
    return null;
  }

  public static getTenantActiveComponents(tenant: Tenant): string[] {
    const components: string[] = [];
    for (const componentName in tenant.components) {
      if (tenant.components[componentName].active) {
        components.push(componentName);
      }
    }
    return components;
  }

  public static isTenantComponentActive(tenant: Tenant, component: TenantComponents): boolean {
    for (const componentName in tenant.components) {
      if (componentName === component) {
        return tenant.components[componentName].active;
      }
    }
    return false;
  }

  public static createDefaultSettingContent(activeComponent, currentSettingContent): SettingDBContent {
    switch (activeComponent.name) {
      // Pricing
      case TenantComponents.PRICING:
        if (!currentSettingContent || currentSettingContent.type !== activeComponent.type) {
          // Create default settings
          if (activeComponent.type === Constants.SETTING_PRICING_CONTENT_TYPE_SIMPLE) {
            // Simple Pricing
            return {
              'type': Constants.SETTING_PRICING_CONTENT_TYPE_SIMPLE,
              'simple': {}
            } as SettingDBContent;
          } else if (activeComponent.type === Constants.SETTING_PRICING_CONTENT_TYPE_CONVERGENT_CHARGING) {
            // SAP CC
            return {
              'type': Constants.SETTING_PRICING_CONTENT_TYPE_CONVERGENT_CHARGING,
              'convergentCharging': {}
            } as SettingDBContent;
          }
        }
        break;

      // Billing
      case TenantComponents.BILLING:
        if (!currentSettingContent || currentSettingContent.type !== activeComponent.type) {
          // Only Stripe
          return {
            'type': Constants.SETTING_BILLING_CONTENT_TYPE_STRIPE,
            'stripe': {}
          } as SettingDBContent;
        }
        break;

      // Refund
      case TenantComponents.REFUND:
        if (!currentSettingContent || currentSettingContent.type !== activeComponent.type) {
          // Only Concur
          return {
            'type': Constants.SETTING_REFUND_CONTENT_TYPE_CONCUR,
            'concur': {}
          } as SettingDBContent;
        }
        break;

      // Refund
      case TenantComponents.OCPI:
        if (!currentSettingContent || currentSettingContent.type !== activeComponent.type) {
          // Only Gireve
          return {
            'type': Constants.SETTING_REFUND_CONTENT_TYPE_GIREVE,
            'ocpi': {}
          } as SettingDBContent;
        }
        break;

      // SAC
      case TenantComponents.ANALYTICS:
        if (!currentSettingContent || currentSettingContent.type !== activeComponent.type) {
          // Only SAP Analytics
          return {
            'type': Constants.SETTING_REFUND_CONTENT_TYPE_SAC,
            'sac': {}
          } as SettingDBContent;
        }
        break;

      // Smart Charging
      case TenantComponents.SMART_CHARGING:
        if (!currentSettingContent || currentSettingContent.type !== activeComponent.type) {
          // Only SAP sapSmartCharging
          return {
            'type': Constants.SETTING_SMART_CHARGING_CONTENT_TYPE_SAP_SMART_CHARGING,
            'sapSmartCharging': {}
          } as SettingDBContent;
        }
        break;

      // Asset
      case TenantComponents.ASSET:
        if (!currentSettingContent || currentSettingContent.type !== activeComponent.type) {
          // Only Asset
          return {
            'type': null,
          } as SettingDBContent;
        }
        break;
    }
  }

  public static isChargingStationIDValid(name: string): boolean {
    return /^[A-Za-z0-9_-]*$/.test(name);
  }

  public static isPasswordValid(password: string): boolean {
    // eslint-disable-next-line no-useless-escape
    return /(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!#@:;,<>\/''\$%\^&\*\.\?\-_\+\=\(\)])(?=.{8,})/.test(password);
  }

  public static checkIfCarValid(car: Partial<Car>, req: Request): void {
    if (req.method !== 'POST' && !car.id) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Car ID is mandatory',
        module: MODULE_NAME,
        method: 'checkIfCarValid',
        user: req.user.id
      });
    }
    if (!car.vin) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Vin Car is mandatory',
        module: MODULE_NAME,
        method: 'checkIfCarValid',
        user: req.user.id
      });
    }
    if (!car.licensePlate) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'License Plate is mandatory',
        module: MODULE_NAME,
        method: 'checkIfCarValid',
        user: req.user.id
      });
    }
    if (!car.carCatalogID) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Car Catalog ID  is mandatory',
        module: MODULE_NAME,
        method: 'checkIfCarValid',
        user: req.user.id
      });
    }
  }

  private static _isUserEmailValid(email: string): boolean {
    return validator.isEmail(email);
  }

  private static _areTagsValid(tags: Tag[]): boolean {
    return tags.filter((tag) => /^[A-Za-z0-9,]*$/.test(tag.id)).length === tags.length;
  }

  private static _isPhoneValid(phone: string): boolean {
    return /^\+?([0-9] ?){9,14}[0-9]$/.test(phone);
  }

  private static _isPlateIDValid(plateID): boolean {
    return /^[A-Z0-9-]*$/.test(plateID);
  }
}
