import { getFromContainer } from "../container";
import { ODataManager } from "./ODataManager";
import { getSteedosSchema } from "@steedos/objectql";
import { oDataExpressMiddleware } from "./ODataExpressMiddleware";
import { meteorODataExpressMiddleware } from './MeteorODataExpressMiddleware';

/**
 * Gets a ODataManager.
 */
export function getODataManager(): ODataManager {
   return getFromContainer(ODataManager);
}

export async function getObjectList(req, res) {
   const isMeteorDriver = await _isMeteorDriver(req);
   if (isMeteorDriver) {
      return await meteorODataExpressMiddleware.getObjectList(req, res);
   }
   else {
      return await oDataExpressMiddleware.getObjectList(req, res);
   }
}
export async function getObjectRecent(req, res) {
   const isMeteorDriver = await _isMeteorDriver(req);
   if (isMeteorDriver) {
      return await meteorODataExpressMiddleware.getObjectRecent(req, res);
   }
   else {
      return await oDataExpressMiddleware.getObjectRecent(req, res);
   }
}
export async function createObjectData(req, res) {
   const isMeteorDriver = await _isMeteorDriver(req);
   if (isMeteorDriver) {
      return await meteorODataExpressMiddleware.createObjectData(req, res);
   }
   else {
      return await oDataExpressMiddleware.createObjectData(req, res);
   }
}
export async function getObjectData(req, res) {
   const isMeteorDriver = await _isMeteorDriver(req);
   if (isMeteorDriver) {
      return await meteorODataExpressMiddleware.getObjectData(req, res);
   }
   else {
      return await oDataExpressMiddleware.getObjectData(req, res);
   }
}
export async function updateObjectData(req, res) {
   const isMeteorDriver = await _isMeteorDriver(req);
   if (isMeteorDriver) {
      return await meteorODataExpressMiddleware.updateObjectData(req, res);
   }
   else {
      return await oDataExpressMiddleware.updateObjectData(req, res);
   }
}
export async function deleteObjectData(req, res) {
   const isMeteorDriver = await _isMeteorDriver(req);
   if (isMeteorDriver) {
      return await meteorODataExpressMiddleware.deleteObjectData(req, res);
   }
   else {
      return await oDataExpressMiddleware.deleteObjectData(req, res);
   }
}
export async function excuteObjectMethod(req, res) {
   return await meteorODataExpressMiddleware.excuteObjectMethod(req, res);
}

/* yupeng: req.params 参数样例：

{
  objectName: "objects",
}

*/
async function _isMeteorDriver(req) {
   let urlParams = req.params;
   let key = urlParams.objectName;

   // yupeng: 拿到“对象配置”，对象配置中有一个字段是 datasource，判断是否是 meteor
   let objectConfig = await getSteedosSchema().getObject(key).toConfig();
   return objectConfig.datasource === 'meteor';
   // return collection != null;
}