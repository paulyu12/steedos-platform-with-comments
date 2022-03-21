
import { getCreator } from '../index';
import { getODataManager } from './server';

import querystring = require('querystring');
import odataV4Mongodb = require('odata-v4-mongodb');
import _ = require('underscore');
import { Response } from 'express';
import * as core from "express-serve-static-core";
import { getObjectConfig } from "@steedos/objectql";
interface Request extends core.Request {
    user: any;
}

const getObjectList = async function (req: Request, res: Response) {
    try {
        /* yupeng: 参数样例
        userId: "622f79fb66e225001e073ca8"
        urlParams: {
            objectName: "objects",
        }
        queryParams: {
            $select: "label,created,name,enable_search,owner,company_id,company_ids,locked",
        }
        */
        let userSession = req.user;
        let userId = userSession.userId;
        let urlParams = req.params;
        let queryParams = req.query;

        let key = urlParams.objectName;
        let spaceId = userSession.spaceId;

        // yupeng: 返回一个关于该对象的 SteedosObjectType 的实例，包含在该对象上的所有方法
        // yupeng: 代码位置 \packages\objectql\src\types\object.ts
        let collection = getCreator().getSteedosSchema().getObject(key);
        let setErrorMessage = getODataManager().setErrorMessage;

        if (!collection) {
            res.status(401).send(setErrorMessage(404, collection, key))
        }

        // yupeng: $filter 参数中不允许使用 tolower() 方法，这里将其从 $filter 中移除
        getODataManager().removeInvalidMethod(queryParams);

        // yupeng: 这里对 queryParams 进行解码，防止有 %20 等编码后的字符
        let qs = decodeURIComponent(querystring.stringify(queryParams as querystring.ParsedUrlQueryInput));

        // yupeng: createQuery 是 odata-v4-mongodb 库的方法，这里用来格式化 query，便于后面处理
        if (qs) {
            var createQuery = odataV4Mongodb.createQuery(qs);
        } else {
            var createQuery: any = {
                query: {},
                sort: undefined,
                projection: {},
                includes: []
            };
        }

        // yupeng: 获取对象权限
        let permissions = await collection.getUserObjectPermission(userSession);
        if (permissions.viewAllRecords || (permissions.viewCompanyRecords) || (permissions.allowRead && userId)) {
            let entities = [];
            let filters = queryParams.$filter as string || '';
            let fields = [];

            if (queryParams.$select) {
                fields = _.keys(createQuery.projection)
            }

            filters = getODataManager().excludeDeleted(filters);

            // yupeng: 处理 top, skip, sort 子句
            if (queryParams.$top !== '0') {
                let query = { filters: filters, fields: fields, top: Number(queryParams.$top) };
                if (queryParams.hasOwnProperty('$skip')) {
                    query['skip'] = Number(queryParams.$skip);
                }
                if (queryParams.$orderby) {
                    query['sort'] = queryParams.$orderby;
                }

                // yupeng: 这里处理 lookup 或 master-detail 字段关联的子表。要求 createQuery 对象中有 includes 字段
                /* ypueng: 返回样例
                [
                    {
                        from: ,
                        localField: ,
                        foreignField: ,
                        as: `${refFieldName}_$lookup`
                    },
                    {
                        from: ,
                        localField: ,
                        foreignField: ,
                        as: `${refFieldName}_$lookup`
                    },
                ]

                */
                let externalPipeline = await getODataManager().makeAggregateLookup(createQuery, key, spaceId, userSession);

                // yupeng: mongo 培训中有讲到的一种 mongo 查询方式，可以完全替代 find, update, insert 等特殊用法
                entities = await collection.aggregate(query, externalPipeline, userSession);
            }
            if (entities) {

                // yupeng: 处理子表查询
                entities = await getODataManager().dealWithAggregateLookup(createQuery, entities, key, spaceId, userSession);

                // yupeng: 构造 odata 返回报文
                let body = {};
                body['@odata.context'] = getCreator().getODataContextPath(spaceId, key);
                if (queryParams.$count != 'false') {
                    body['@odata.count'] = await collection.count({ filters: filters, fields: ['_id'] }, userSession);
                }
                let entities_OdataProperties = getCreator().setOdataProperty(entities, spaceId, key);

                body['value'] = entities_OdataProperties;
                getODataManager().setHeaders(res);
                res.send(body);
            } else {
                res.status(404).send(setErrorMessage(404, collection, key))
            }
        } else {
            res.status(403).send(setErrorMessage(403, collection, key, 'get'))
        }
    } catch (error) {
        let handleError = getODataManager().handleError(error);
        res.status(handleError.statusCode).send(handleError.body)
    }
}

const getObjectRecent = async function (req: Request, res: Response) {
    try {
        let userSession = req.user;
        let userId = userSession.userId;
        let urlParams = req.params;
        let queryParams = req.query;
        let key = urlParams.objectName;
        let spaceId = userSession.spaceId;
        let collection = getCreator().getSteedosSchema().getObject(key);
        let setErrorMessage = getODataManager().setErrorMessage;

        if (!collection) {
            res.status(401).send(setErrorMessage(404, collection, key));
        }
        let permissions = await collection.getUserObjectPermission(userSession);
        if (permissions.allowRead) {
            let recent_view_collection = getCreator().getSteedosSchema().getObject('object_recent_viewed');

            // yupeng：过滤条件：由 userId 用户创建的，object_recent_viewed 表中 record.o 为 key 的记录（意为 record.owner = `key`）
            let filterstr = `(record/o eq '${key}') and (created_by eq '${userId}')`;
            let recent_view_options: any = { filters: filterstr, fields: ['record'], sort: 'created desc' };
            let recent_view_records = await recent_view_collection.find(recent_view_options, userSession);
            let odataCount = recent_view_records.length;

            // yupeng：_.pluck 函数从返回的结果数组 recent_view_records 中获取 record 字段
            let recent_view_records_ids: any = _.pluck(recent_view_records, 'record');
            recent_view_records_ids = recent_view_records_ids.getProperty('ids');

            // yupeng：由于 ids 字段也是个数组，_.flatten 方法能够递归地遍历所有子数组，然后整理成一个一级的数组并返回
            // yupeng: _.uniq 去重
            recent_view_records_ids = _.flatten(recent_view_records_ids);
            recent_view_records_ids = _.uniq(recent_view_records_ids);

            // yupeng: 至此，拿到了所有需要查询的记录 id，保存在 recent_view_records_ids 中
            // yupeng: 下面，将要去对应的对象表中，将这些记录查找出来

            getODataManager().removeInvalidMethod(queryParams);
            let qs = decodeURIComponent(querystring.stringify(queryParams as querystring.ParsedUrlQueryInput));
            if (qs) {
                var createQuery = odataV4Mongodb.createQuery(qs);
            } else {
                var createQuery: any = {
                    query: {},
                    sort: undefined,
                    projection: {},
                    includes: [],
                    limit: 100
                };
            }

            let entities = [];
            let filters = queryParams.$filter as string ;
            let fields = [];
            if (queryParams.$select) {
                fields = _.keys(createQuery.projection)
            }
            getODataManager().excludeDeleted(filters)
            if (queryParams.$top !== '0') {
                if (recent_view_records_ids.length > createQuery.limit) {
                    recent_view_records_ids = _.first(recent_view_records_ids, createQuery.limit)
                }
                let idsFilters = _.map(recent_view_records_ids, function (reid) {
                    return `(_id eq '${reid}')`
                }).join(' or ')
                if (_.isEmpty(recent_view_records_ids)) {
                    idsFilters = '_id eq -1'
                }
                filters = filters ? `(${filters}) and (${idsFilters})` : idsFilters;
                let query = { filters: filters, fields: fields, top: Number(queryParams.$top) };
                if (queryParams.hasOwnProperty('$skip')) {
                    query['skip'] = Number(queryParams.$skip);
                }
                if (queryParams.$orderby) {
                    query['sort'] = queryParams.$orderby;
                }

                entities = await collection.find(query, userSession);
            }
            let entities_ids = _.pluck(entities, '_id');
            let sort_entities = [];
            if (!queryParams.$orderby) {
                _.each(recent_view_records_ids, function (recent_view_records_id) {
                    var index;
                    index = _.indexOf(entities_ids, recent_view_records_id);
                    if (index > -1) {
                        return sort_entities.push(entities[index]);
                    }
                });
            } else {
                sort_entities = entities;
            }
            if (sort_entities) {
                await getODataManager().dealWithExpand(createQuery, sort_entities, key, urlParams.spaceId, userSession);
                let body = {};
                body['@odata.context'] = getCreator().getODataContextPath(spaceId, key);
                if (queryParams.$count != 'false') {
                    body['@odata.count'] = odataCount;
                }
                let entities_OdataProperties = getCreator().setOdataProperty(sort_entities, spaceId, key);
                body['value'] = entities_OdataProperties;
                getODataManager().setHeaders(res);
                res.send(body);
            } else {
                res.status(404).send(setErrorMessage(404, collection, key, 'get'));
            }
        } else {
            res.status(403).send(setErrorMessage(403, collection, key, 'get'));
        }
    } catch (error) {
        let handleError = getODataManager().handleError(error);
        res.status(handleError.statusCode).send(handleError.body);
    }
}

const createObjectData = async function (req: Request, res: Response) {
    try {
        let userSession = req.user;
        // let userId = userSession.userId;
        let urlParams = req.params;
        let bodyParams = req.body;
        let key = urlParams.objectName;
        let spaceId = userSession.spaceId;

        // yupeng: 获取 SteedosSchema，里面定义了一堆操作对象的方法。供全局使用
        let collection = getCreator().getSteedosSchema().getObject(key);
        let setErrorMessage = getODataManager().setErrorMessage;

        if (!collection) {
            res.status(401).send(setErrorMessage(404, collection, key));
        }

        // yupeng：
        let permissions = await collection.getUserObjectPermission(userSession);
        if (permissions.allowCreate) {
            bodyParams.space = spaceId;
            if (spaceId == 'guest') {
                delete bodyParams.space;
            }
            let entity = await collection.insert(bodyParams, userSession);

            // yupeng: 构造返回报文
            let entities = [];
            if (entity) {
                let body = {};
                entities.push(entity);
                body['@odata.context'] = getCreator().getODataContextPath(spaceId, key) + '/$entity';
                let entity_OdataProperties = getCreator().setOdataProperty(entities, spaceId, key);
                body['value'] = entity_OdataProperties;
                getODataManager().setHeaders(res);
                res.send(body);
            }
        } else {
            res.status(403).send(setErrorMessage(403, collection, key, 'post'));
        }
    } catch (error) {
        let handleError = getODataManager().handleError(error);
        res.status(handleError.statusCode).send(handleError.body);
    }
}

const getObjectData = async function (req: Request, res: Response) {
    let userSession = req.user;
    let urlParams = req.params;
    let queryParams = req.query;
    let key = urlParams.objectName;
    let spaceId = userSession.spaceId;

    // yupeng: recordId 格式可能为 ********** 或 ********_expand() 表示从另一个对象扩展
    let recordId = urlParams._id;
    let setErrorMessage = getODataManager().setErrorMessage;
    if (key.indexOf("(") > -1) {
        let body = {};
        let collectionInfo = key;
        let fieldName = recordId.split('_expand')[0];  // yupeng: 某个 field 可能是带有 expand，是指向另一个对象
        let collectionInfoSplit = collectionInfo.split('(');
        let collectionName = collectionInfoSplit[0];

        // yupeng: 这里的 id 拿到了 recordId 是从 id 对象扩展来的
        let id = collectionInfoSplit[1].split('\'')[1];
        let collection = getCreator().getSteedosSchema().getObject(collectionName)
        let entity = await collection.findOne(id, {
            fields: [fieldName]
        });
        let fieldValue = null;
        if (entity) {
            fieldValue = entity[fieldName];
        }
        let field = await collection.getField(fieldName);
        if (field && fieldValue && (field.type === 'lookup' || field.type === 'master_detail')) {
            let lookupCollection = getCreator().getSteedosSchema().getObject(field.reference_to);
            let fields = [];
            // let readable_fields: any = await getCreator().getFields(field.reference_to, spaceId, userId);
            let permissions = await lookupCollection.getUserObjectPermission(userSession);
            let referenceObjectFields = await lookupCollection.getFields();
            let readable_fields: any = getODataManager().getReadableFields(referenceObjectFields, permissions.unreadable_fields);
            _.each(readable_fields, function (f: string) {
                if (f.indexOf('$') < 0) {
                    return fields.push(f)
                }
            });
            if (field.multiple) {
                let values = [];
                let filters = [];
                _.each(fieldValue, function (f) {
                    filters.push(`(_id eq '${f}')`);
                });
                (await lookupCollection.find({
                    filters: filters.join(' or '),
                    fields: fields
                }, userSession)).forEach(function (obj) {
                    _.each(obj, function (v, k) {
                        if (_.isArray(v) || (_.isObject(v) && !_.isDate(v))) {
                            return obj[k] = JSON.stringify(v);
                        }
                    });
                    return values.push(obj);
                });
                body['value'] = values;
                body['@odata.context'] = getCreator().getMetaDataPath(spaceId) + ("#" + collectionInfo + "/" + recordId);
            } else {
                body = (await lookupCollection.findOne(fieldValue, { fields: fields })) || {};
                _.each(body, function (v, k) {
                    if (_.isArray(v) || (_.isObject(v) && !_.isDate(v))) {
                        return body[k] = JSON.stringify(v);
                    }
                });
                body['@odata.context'] = getCreator().getMetaDataPath(spaceId) + ("#" + field.reference_to + "/$entity");
            }
        } else {
            body['@odata.context'] = getCreator().getMetaDataPath(spaceId) + ("#" + collectionInfo + "/" + recordId);
            body['value'] = fieldValue;
        }
        getODataManager().setHeaders(res);
        res.send(body);
    } else {
        try {
            let collection = getCreator().getSteedosSchema().getObject(key)
            if (!collection) {
                res.status(404).send(setErrorMessage(404, collection, key));
            }
            let permissions = await collection.getUserObjectPermission(userSession);
            if (permissions.allowRead) {
                getODataManager().removeInvalidMethod(queryParams);
                let qs = decodeURIComponent(querystring.stringify(queryParams as querystring.ParsedUrlQueryInput));
                if (qs) {
                    var createQuery = odataV4Mongodb.createQuery(qs);
                } else {
                    var createQuery: any = {
                        query: {},
                        sort: undefined,
                        projection: {},
                        includes: []
                    };
                }

                let fields = [];
                if (queryParams.$select) {
                    fields = _.keys(createQuery.projection)
                }

                let entity = await collection.findOne(recordId, { fields: fields }, userSession);
                let entities = [];
                if (entity) {
                    let body = {};
                    entities.push(entity);
                    await getODataManager().dealWithExpand(createQuery, entities, key, spaceId, userSession);
                    body['@odata.context'] = getCreator().getODataContextPath(spaceId, key) + '/$entity';
                    let entity_OdataProperties = getCreator().setOdataProperty(entities, spaceId, key);
                    _.extend(body, entity_OdataProperties[0]);
                    getODataManager().setHeaders(res);
                    res.send(body);
                } else {
                    res.status(404).send(setErrorMessage(404, collection, key, 'get'));
                }
            } else {
                res.status(403).send(setErrorMessage(403, collection, key, 'get'));
            }
        } catch (error) {
            let handleError = getODataManager().handleError(error);
            res.status(handleError.statusCode).send(handleError.body);
        }
    }
}

const updateObjectData = async function (req: Request, res: Response) {
    try {
        let userSession = req.user;
        let userId = userSession.userId;
        let urlParams = req.params;
        let bodyParams = req.body;
        let key = urlParams.objectName;
        let spaceId = userSession.spaceId;
        let recordId = urlParams._id;
        let setErrorMessage = getODataManager().setErrorMessage;

        // yupeng: 获取"对象操作"实例
        let collection = getCreator().getSteedosSchema().getObject(key)
        if (!collection) {
            res.status(404).send(setErrorMessage(404, collection, key));
        }

        // yupeng: 获取用户的对象权限
        let permissions = await collection.getUserObjectPermission(userSession);
        let record_owner = ""
        if (key == "users") {
            record_owner = recordId;
        } else {
            record_owner = (await collection.findOne(recordId, { fields: ['owner'] })).owner
        }
        // let companyId = (await collection.findOne(recordId, { fields: ['company_id'] })).company_id

        let isAllowed = permissions.modifyAllRecords || (permissions.allowEdit && record_owner == userId) || (permissions.modifyCompanyRecords);
        if (isAllowed) {

            // yupeng: 标准对象记录的 doc.space = 'global'，这样的记录不允许修改
            await getODataManager().checkGlobalRecord(collection, recordId, collection);

            let fields_editable = true;

            if (fields_editable) {

                // yupeng: 整理要 set 的字段、要 unset 的字段，存到 data 对象中
                let data = bodyParams.$set ? bodyParams.$set : bodyParams
                let unsetData = bodyParams.$unset ? bodyParams.$unset : {}
                _.each(unsetData, function (v, k) {
                    data[k] = null;
                })
                let entityIsUpdated = await collection.update(recordId, data, userSession);
                if (entityIsUpdated) {

                    // yupeng: 整理应答报文
                    let entities = []
                    let body = {};
                    entities.push(entityIsUpdated);
                    body['@odata.context'] = getCreator().getODataContextPath(spaceId, key) + '/$entity';
                    let entity_OdataProperties = getCreator().setOdataProperty(entities, spaceId, key);
                    body['value'] = entity_OdataProperties;
                    getODataManager().setHeaders(res);
                    res.send(body);
                } else {
                    res.status(404).send(setErrorMessage(404, collection, key));
                }
            } else {
                res.status(403).send(setErrorMessage(403, collection, key, 'put'));
            }
        } else {
            res.status(403).send(setErrorMessage(403, collection, key, 'put'));
        }
    } catch (error) {
        let handleError = getODataManager().handleError(error);
        res.status(handleError.statusCode).send(handleError.body);
    }
}

const deleteObjectData = async function (req: Request, res: Response) {
    try {
        let userSession = req.user;
        let userId = userSession.userId;
        let urlParams = req.params;
        let key = urlParams.objectName;
        // let spaceId = userSession.spaceId;
        let recordId = urlParams._id;
        let setErrorMessage = getODataManager().setErrorMessage;

        let collection = getCreator().getSteedosSchema().getObject(key);
        if (!collection) {
            res.status(404).send(setErrorMessage(404, collection, key));
        }
        let permissions = await collection.getUserObjectPermission(userSession);
        let recordData = await collection.findOne(recordId, { fields: ['owner', 'company_id'] });
        if(!recordData){
            return res.send({});
        }
        let record_owner = recordData.owner;
        // let companyId = recordData.company_id;
        let isAllowed = (permissions.modifyAllRecords && permissions.allowDelete) || (permissions.modifyCompanyRecords && permissions.allowDelete) || (permissions.allowDelete && record_owner === userId);
        if (isAllowed) {

            // yupeng: 不允许删除标准对象
            await getODataManager().checkGlobalRecord(collection, recordId, collection);


            // yupeng: 该对象记录是否支持软删除
            if (collection != null ? collection.enable_trash : void 0) {
                let entityIsUpdated = await collection.update(recordId, {
                    is_deleted: true,
                    deleted: new Date(),
                    deleted_by: userId
                }, userSession);
                if (entityIsUpdated) {
                    getODataManager().setHeaders(res);
                    res.send({});
                } else {
                    res.status(404).send(setErrorMessage(404, collection, key));
                }
            } else {
                await collection.delete(recordId, userSession)
                getODataManager().setHeaders(res);
                res.send({});
            }
        } else {
            res.status(403).send(setErrorMessage(403, collection, key));
        }
    } catch (error) {
        let handleError = getODataManager().handleError(error);
        res.status(handleError.statusCode).send(handleError.body);
    }
}

const excuteObjectMethod = async function (req: Request, res: Response) {
    try {
        let userSession = req.user;
        // let userId = userSession.userId;
        let urlParams = req.params;
        // let bodyParams = req.body;
        let key = urlParams.objectName;
        // let spaceId = userSession.spaceId;
        let collection = getCreator().getSteedosSchema().getLocalObject(key);
        let setErrorMessage = getODataManager().setErrorMessage;

        if (!collection) {
            res.status(401).send(setErrorMessage(404, collection, key));
        }
        let permissions = await collection.getUserObjectPermission(userSession);
        if (permissions.allowRead) {
            let methodName = urlParams.methodName;
            let methods = getObjectConfig(key).methods || {};

            // yupeng: 判断该对象支持的操作方法，是否包含此次请求中要执行的 method
            if (methods.hasOwnProperty(methodName)) {
                // let thisObj = {
                //     object_name: key,
                //     record_id: urlParams._id,
                //     space_id: spaceId,
                //     user_id: userId,
                //     permissions: permissions,
                //     userSession: userSession,
                //     getObject: (object_name: string) => {
                //         return getCreator().getSteedosSchema().getObject(object_name)
                //     }
                // }

                // yupeng: 这里 methods[methodName] 是一个在 object.ts 中的函数名称，这里采用 apply 方法执行这个方法
                methods[methodName].apply({}, [req, res])
            } else {
                res.status(404).send(setErrorMessage(404, collection, key));
            }
        } else {
            res.status(403).send(setErrorMessage(403, collection, key, 'post'));
        }
    } catch (error) {
        let handleError = getODataManager().handleError(error);
        res.status(handleError.statusCode).send(handleError.body);
    }
}

export const meteorODataExpressMiddleware = {
    getObjectList,
    getObjectRecent,
    createObjectData,
    getObjectData,
    updateObjectData,
    deleteObjectData,
    excuteObjectMethod
}