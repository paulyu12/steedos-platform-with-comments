import { Dictionary, JsonMap } from "@salesforce/ts-types";
import { SteedosTriggerType, SteedosFieldType, SteedosFieldTypeConfig, SteedosSchema, SteedosListenerConfig, SteedosObjectListViewTypeConfig, SteedosObjectListViewType, SteedosIDType, SteedosObjectPermissionTypeConfig, SteedosActionType, SteedosActionTypeConfig, SteedosUserSession, getSteedosSchema } from ".";
import { getUserObjectSharesFilters, isTemplateSpace, isCloudAdminSpace, generateActionParams, absoluteUrl } from '../util'
import _ = require("underscore");
import { SteedosTriggerTypeConfig, SteedosTriggerContextConfig } from "./trigger";
import { SteedosQueryOptions, SteedosQueryFilters } from "./query";
import { SteedosDataSourceType, SteedosDatabaseDriverType } from "./datasource";
import { SteedosFieldDBType } from '../driver/fieldDBType';
import { runCurrentObjectFieldFormulas, runQuotedByObjectFieldFormulas } from '../formula';
import { runQuotedByObjectFieldSummaries, runCurrentObjectFieldSummaries } from '../summary';
import { formatFiltersToODataQuery } from "@steedos/filters";
import { WorkflowRulesRunner } from '../actions';
import { runValidationRules } from './validation_rules';
import { brokeEmitEvents } from "./object_events";
import { translationObject } from "@steedos/i18n";
import { getObjectLayouts } from "./object_layouts";
import { sortBy, forEach } from 'lodash';
import { ShareRules } from './shareRule';
import { RestrictionRule } from './restrictionRule';
import { FieldPermission } from './field_permission';

const clone = require('clone')

// 主子表有层级限制，超过3层就报错，该函数判断当前对象作为主表对象往下的层级最多不越过3层，
// 其3层指的是A-B-C-D，它们都有父子关系，A作为最顶层，该对象上不可以再创建主表子表关系字段，但是B、C、D上可以；
// 或者如果当前对象上创建的主表子表关系字段指向的对象是D，那么也会超过3层的层级限制；
// 又或者中间加一层M先连接B再连接C，形成A-B-M-C-D，也会超过3层的层级限制；
export const MAX_MASTER_DETAIL_LEAVE = 3;

/**
 * 判断传入的paths中每条path下是否有重复对象名称，返回第一个重复的对象名称
 * 有可能传入的paths有多个链条，只要其中任何一个链条上有同名对象名说明异常，返回第一个异常的同名对象名即可
 * 比如传入下面示例中的paths，表示当前对象b向下有4条主子关系链，将返回第三条链中的重复对象名b
 * @param paths 对象上getDetailPaths或getMasterPaths函数返回的当前对象向下或向上取主表子表关联对象名称列表链条
 * [
    [ 'b', 't1', 't2' ],
    [ 'b', 't1', 'm1', 'm2' ],
    [ 'b', 't1', 'm2', 'b' ],
    [ 'b', 'c', 'd' ]
 * ]
 */
export const getRepeatObjectNameFromPaths = (paths: string[]) => {
    let repeatItem: string;
    for (let p of paths) {
        if (repeatItem) {
            break;
        }
        let g = _.groupBy(p);
        for (let k in g) {
            if (g[k].length > 1) {
                repeatItem = k;
                break;
            }
        }
    }
    return repeatItem;
}

abstract class SteedosObjectProperties {
    _id?: string
    abstract name?: string
    extend?: string
    abstract table_name?: string
    label?: string
    icon?: string
    enable_search?: boolean
    is_enable?: boolean
    enable_files?: boolean
    enable_tasks?: boolean
    enable_notes?: boolean
    enable_events?: boolean
    enable_api?: boolean  //TODO 未开放功能
    abstract enable_share?: boolean
    abstract enable_instances?: boolean
    enable_chatter?: boolean
    abstract enable_audit?: boolean
    abstract enable_trash?: boolean
    enable_space_global?: boolean
    enable_tree?: boolean
    parent_field?: string
    children_field?: string
    enable_enhanced_lookup?: boolean
    enable_inline_edit?: boolean
    enable_approvals?: boolean
    enable_process?: boolean
    is_view?: boolean
    hidden?: boolean
    description?: string
    custom?: boolean
    owner?: string
    // triggers?: object
    sidebar?: object //TODO
    calendar?: object //TODO
    abstract actions?: Dictionary<SteedosActionTypeConfig>
    abstract fields?: Dictionary<SteedosFieldTypeConfig>
    abstract listeners?: Dictionary<SteedosListenerConfig>
    abstract list_views?: Dictionary<SteedosObjectListViewTypeConfig>
    permissions?: Dictionary<SteedosObjectPermissionTypeConfig>
    methods?: Dictionary<Function>
    fields_serial_number?: number
}



export interface SteedosObjectTypeConfig extends SteedosObjectProperties {
    __filename?: string
    name?: string
    isMain?: boolean
    datasource?: string
    fields?: Dictionary<SteedosFieldTypeConfig>
    actions?: Dictionary<SteedosActionTypeConfig>
    listeners?: Dictionary<SteedosListenerConfig>
    permission_set?: Dictionary<SteedosObjectPermissionTypeConfig> //TODO remove ; 目前为了兼容现有object的定义保留
}

const _TRIGGERKEYS = ['beforeFind', 'beforeInsert', 'beforeUpdate', 'beforeDelete', 'afterFind', 'afterCount', 'afterFindOne', 'afterInsert', 'afterUpdate', 'afterDelete', 'beforeAggregate', 'afterAggregate']

const properties = ['label', 'icon', 'enable_search', 'sidebar', 'is_enable', 'enable_files', 'enable_tasks', 'enable_notes', 'enable_events', 'enable_api', 'enable_share', 'enable_instances', 'enable_chatter', 'enable_audit', 'enable_web_forms', 'enable_inline_edit', 'enable_approvals', 'enable_trash', 'enable_space_global', 'enable_tree', 'parent_field', 'children_field', 'enable_enhanced_lookup', 'enable_workflow', 'is_view', 'hidden', 'description', 'custom', 'owner', 'methods', '_id', 'relatedList', 'fields_serial_number', "is_enable", "in_development", "version"]

export class SteedosObjectType extends SteedosObjectProperties {

    private _schema: SteedosSchema;
    private _datasource: SteedosDataSourceType;
    public get datasource(): SteedosDataSourceType {
        return this._datasource;
    }
    private _name: string;
    private _fields: Dictionary<SteedosFieldType> = {};
    private _actions: Dictionary<SteedosActionType> = {};
    private _listeners: Dictionary<SteedosListenerConfig> = {};
    private _triggers: Dictionary<SteedosTriggerType> = {};
    private _list_views: Dictionary<SteedosObjectListViewType> = {};
    private _table_name: string;
    private _triggersQueue: Dictionary<Dictionary<SteedosTriggerType>> = {}
    private _idFieldName: string;
    private _idFieldNames: string[] = [];
    private _NAME_FIELD_KEY: string;
    private _masters: string[] = [];
    private _details: string[] = [];

    private _enable_audit: boolean;
    public get enable_audit(): boolean {
        return this._enable_audit;
    }
    public set enable_audit(value: boolean) {
        if (value && !this._datasource.enable_space) {
            throw new Error(`not support, please set ${this._name}.enable_audit to false or remove the enable_audit attribute`)
        }
        this._enable_audit = value;
    }

    private _enable_instances: boolean;
    public get enable_instances(): boolean {
        return this._enable_instances;
    }
    public set enable_instances(value: boolean) {
        if (value && !this._datasource.enable_space) {
            throw new Error(`not support, please set ${this._name}.enable_instances to false or remove the enable_instances attribute`)
        }
        this._enable_instances = value;
    }

    private _enable_trash: boolean;
    public get enable_trash(): boolean {
        return this._enable_trash;
    }
    public set enable_trash(value: boolean) {
        if (value && !this._datasource.enable_space) {
            throw new Error(`not support, please set ${this._name}.enable_trash to false or remove the enable_trash attribute`)
        }
        this._enable_trash = value;
    }

    private _enable_share;
    public get enable_share(): boolean {
        return this._enable_share;
    }
    public set enable_share(value: boolean) {
        if (value && !this._datasource.enable_space) {
            throw new Error(`not support, please set ${this._name}.enable_share to false or remove the enable_share attribute`)
        }
        this._enable_share = value;
    }

    public get NAME_FIELD_KEY(): string {
        return this._NAME_FIELD_KEY;
    }

    getMethod(method_name: string) {
        return this.methods[method_name]
    }

    public get idFieldName(): string {
        return this._idFieldName;
    }

    public get idFieldNames(): string[] {
        return this._idFieldNames;
    }

    public get masters(): string[] {
        return this._masters;
    }

    public get details(): string[] {
        return this._details;
    }

    private async callMetadataObjectServiceAction(action, params?){
        const actionFullName = `objects.${action}`
        const result = await this.schema.metadataBroker.call(actionFullName, params);
        return result;
    }

    private checkField() {
        let driverSupportedColumnTypes = this._datasource.adapter.getSupportedColumnTypes()
        _.each(this.fields, (field: SteedosFieldType, key: string) => {
            if (SteedosFieldDBType[field.fieldDBType] && !driverSupportedColumnTypes.includes(field.fieldDBType)) {
                throw new Error(`driver ${this._datasource.driver} can not support field ${key} config`)
            }
        })
    }

    constructor(object_name: string, datasource: SteedosDataSourceType, config: SteedosObjectTypeConfig) {
        super();
        this._name = object_name
        this._datasource = datasource
        this._schema = datasource.schema
        if (this._datasource.driver != SteedosDatabaseDriverType.MeteorMongo)
            this._enable_share = false

        if (/^[_a-zA-Z][_a-zA-Z0-9]*$/.test(object_name) != true) {
            throw new Error('invalid character, object_name can only be start with _ or a-zA-Z and contain only _ or _a-zA-Z0-9. you can set table_name');
        }

        if (config.table_name) {
            this._table_name = config.table_name
        } else {
            this._table_name = this._name
        }

        _.each(properties, (property) => {
            if (_.has(config, property)) {
                this[property] = config[property]
            }
        })

        _.each(config.fields, (field, field_name) => {
            this.setField(field_name, field)
        })

        this.checkField()

        _.each(config.actions, (action, action_name) => {
            this.setAction(action_name, action)
        })

        _.each(config.listeners, (listener, listener_name) => {
            this.setListener(listener_name, listener)
        })

        _.each(config.list_views, (list_view, name) => {
            this.setListView(name, list_view)
        })

        _.each(config.permissions, (permission, name) => {
            permission.name = name
            this.setPermission(permission)
        })

        //TODO remove ; 目前为了兼容现有object的定义保留
        _.each(config.permission_set, (permission, name) => {
            permission.name = name
            this.setPermission(permission)
        })

        if (this._datasource.driver == SteedosDatabaseDriverType.Mongo || this._datasource.driver == SteedosDatabaseDriverType.MeteorMongo) {
            this._idFieldName = '_id'
        }

        this.schema.setObjectMap(this.name, { datasourceName: this.datasource.name, _id: config._id })
    }

    getConfig(){
        return this.datasource.getObjectConfig(this.name);
    }

    setPermission(config: SteedosObjectPermissionTypeConfig) {
        this._datasource.setObjectPermission(this._name, config)
    }

    setListener(listener_name: string, config: SteedosListenerConfig) {
        this.listeners[listener_name] = config
        _TRIGGERKEYS.forEach((key) => {
            let event = config[key];
            if (_.isFunction(event)) {
                this.setTrigger(`${listener_name}_${event.name}`, key, event);
            }
        })
    }

    private setTrigger(name: string, when: string, todo: Function, on = 'server') {
        let triggerConfig: SteedosTriggerTypeConfig = {
            name: name,
            on: on,
            when: when,
            todo: todo,
        }
        let trigger = new SteedosTriggerType(triggerConfig)
        this.triggers[name] = trigger
        this.registerTrigger(trigger)
    }

    registerTrigger(trigger: SteedosTriggerType) {
        //如果是meteor mongo 则不做任何处理
        if (!_.isString(this._datasource.driver) || this._datasource.driver != SteedosDatabaseDriverType.MeteorMongo || trigger.when === 'beforeFind' || trigger.when === 'afterFind' || trigger.when === 'afterFindOne' || trigger.when === 'afterCount' || trigger.when === 'beforeAggregate' || trigger.when === 'afterAggregate') {
            if (!trigger.todo) {
                return;
            }
            if (!this._triggersQueue[trigger.when]) {
                this._triggersQueue[trigger.when] = {}
            }
            this._triggersQueue[trigger.when][trigger.name] = trigger
        }
    }

    unregisterTrigger(trigger: SteedosTriggerType) {
        delete this._triggersQueue[trigger.when][trigger.name]
    }

    private async runTirgger(trigger: SteedosTriggerType, context: SteedosTriggerContextConfig) {
        let object_name = this.name
        let event = trigger.todo
        let todoWrapper = async function (...args) {
            // Object.setPrototypeOf(thisArg, Object.getPrototypeOf(trigger))
            return await event.apply(thisArg, args)
        }
        let thisArg = {
            ...context,
            object_name: object_name,
            datasource_name: this._datasource.name,
            getObject: (object_name: string) => {
                return this._schema.getObject(object_name)
            }
        }

        return await todoWrapper.call(thisArg)
    }

    async runTriggers(when: string, context: SteedosTriggerContextConfig) {
        let triggers = this._triggersQueue[when]
        if (!triggers) {
            return;
        }

        let triggerKeys = _.keys(triggers)

        for (let index = 0; index < triggerKeys.length; index++) {
            let trigger = triggers[triggerKeys[index]];
            await this.runTirgger(trigger, context)
        }
    }

    async runTriggerActions(when: string, context: SteedosTriggerContextConfig) {
        let triggers = await this._schema.metadataBroker.call('triggers.filter', { objectApiName: this.name, when: when })
        if (_.isEmpty(triggers)) {
            return;
        }

        for (const trigger of triggers) {
            let params = generateActionParams(when, context); //参考sf
            await this._schema.metadataBroker.call(`${trigger.service.name}.${trigger.metadata.action}`, params).catch((error)=>{
                //如果action trigger 下线，则只打印error
                if(error && _.isObject(error) && error.type === 'SERVICE_NOT_AVAILABLE'){
                    console.error(`runTriggerActions error`, error)
                }else{
                    throw error
                }
            })
        }

    }

    toConfig() {
        let config: JsonMap = {
            name: this.name,
            fields: {}
        }

        _.each(properties, (property) => {
            if (this[property] != null && this[property] != undefined) {
                config[property] = this[property]
            }
        })

        if (this.fields) {
            config.fields = {}
            _.each(this.fields, (field: SteedosFieldType, key: string) => {
                config.fields[key] = field.toConfig();
            })
        }

        if (this.list_views) {
            config.list_views = {}
            _.each(this.list_views, (list_view: SteedosObjectListViewType, key: string) => {
                config.list_views[key] = list_view.toConfig()
            })
        }

        if (this.actions) {
            config.actions = {}
            _.each(this.actions, (action: SteedosActionType, key: string) => {
                config.actions[key] = action.toConfig()
            })
        }

        if (this.triggers) {
            config.triggers = {}
            _.each(this.triggers, (trigger: SteedosTriggerType, key: string) => {
                config.triggers[key] = trigger.toConfig();
            })
        }

        let rolePermission = this.getObjectRolesPermission()
        if (rolePermission) {
            config.permission_set = {}
            _.each(rolePermission, (v, k) => {
                config.permission_set[k] = v
            })
        }

        config.datasource = this.datasource.name;

        return config
    }

    setField(field_name: string, fieldConfig: SteedosFieldTypeConfig) {
        let field = new SteedosFieldType(field_name, this, fieldConfig)
        this.fields[field_name] = field

        if (field.primary && this._datasource.driver != SteedosDatabaseDriverType.Mongo && this._datasource.driver != SteedosDatabaseDriverType.MeteorMongo) {
            this._idFieldName = field.name
            if (this._idFieldNames.indexOf(field.name) < 0) {
                this._idFieldNames.push(field.name);
            }
        }

        if (field.is_name) {
            this._NAME_FIELD_KEY = field_name
        } else if (field_name == 'name' && !this._NAME_FIELD_KEY) {
            this._NAME_FIELD_KEY = field_name
        }
    }

    getField(field_name: string) {
        return this.fields[field_name]
    }

    getFields(){
        return this.toConfig().fields
    }

    getNameFieldKey(){
        return this.NAME_FIELD_KEY;
    }

    async getDetailPaths(){
        return await this.callMetadataObjectServiceAction(`getDetailPaths`, {objectApiName: this.name});
    }

    async getMasterPaths(){
        return await this.callMetadataObjectServiceAction(`getMasterPaths`, {objectApiName: this.name});
    }

    async getMaxDetailsLeave(paths?){
        return await this.callMetadataObjectServiceAction(`getMaxDetailsLeave`, {objectApiName: this.name, paths});
    }

    async getMaxMastersLeave(paths?){
        return await this.callMetadataObjectServiceAction(`getMaxMastersLeave`, {objectApiName: this.name, paths});
    }
   
    addMaster(object_name: string) {
        let index = this._masters.indexOf(object_name);
        if (index < 0) {
            this._masters.push(object_name);
            return true;
        }
        return false;
    }

    removeMaster(object_name: string) {
        let index = this._masters.indexOf(object_name);
        if (index >= 0) {
            this._masters.splice(index, 1);
        }
    }

    addDetail(object_name: string) {
        let index = this._details.indexOf(object_name);
        if (index < 0) {
            this._details.push(object_name);
            return true;
        }
        return false;
    }

    removeDetail(object_name: string) {
        let index = this._details.indexOf(object_name);
        if (index >= 0) {
            this._details.splice(index, 1);
        }
    }

    setListView(list_view_name: string, config: SteedosObjectListViewTypeConfig) {
        this.list_views[list_view_name] = new SteedosObjectListViewType(list_view_name, this, config)
    }

    setAction(action_name: string, actionConfig: SteedosActionTypeConfig) {
        this._actions[action_name] = new SteedosActionType(action_name, this, actionConfig)
    }

    getAction(action_name: string) {
        return this._actions[action_name]
    }

    async refreshIndexes(){
        if(this.datasource.driver === SteedosDatabaseDriverType.Mongo){
            const adapter = this.datasource.adapter;
            await adapter.connect()
            const collection = (adapter as any).collection(this.name);
            const indexesInfo = [];
            const dropIndexNames = [];
            for (const key in this.fields) {
                const field = this.fields[key];
                const info = field.getIndexInfo();
                if(info){
                    indexesInfo.push(info);
                }else{
                    dropIndexNames.push(field.getIndexName());
                }
            }
            if(indexesInfo && indexesInfo.length > 0){
                try {
                    for await (const indexInfo of indexesInfo) {
                        const key = indexInfo.key;
                        delete indexInfo.key;
                        try {
                            await collection.createIndex(key, indexInfo)
                        } catch (error) {
                            console.error(error)
                        }
                    }
                    // await collection.createIndexes(indexesInfo)
                } catch (error) {
                    console.error(error)
                }
            }
            if(dropIndexNames && dropIndexNames.length > 0){
                try {
                    for await (const indexName of dropIndexNames) {
                        try {
                            await collection.dropIndex(indexName)
                        } catch (error) {
                            
                        }
                    }
                    
                } catch (error) {
                    console.error(error)
                }
            }
        }
    }

    //TODO 处理对象继承
    extend_TODO(config: SteedosObjectTypeConfig) {
        if (this.name != config.name)
            throw new Error("You can not extend on different object");

        // override each fields
        _.each(config.fields, (field, field_name) => {
            this.setField(field_name, field)
        })

        // override each actions
        // if (config.actions) {
        //     _.each(config.actions, (action) => {
        //         this.actions[action.name] = action
        //     })
        // }

        // override each triggers
        // if (config.triggers) {
        //     _.each(config.triggers, (trigger) => {
        //         this.triggers[trigger.name] = trigger
        //     })
        // }
    }

    getObjectRolesPermission(spaceId?: string) {
        let globalPermission = this._datasource.getObjectRolesPermission(this._name)
        if (spaceId) {
            let permission = this._datasource.getObjectSpaceRolesPermission(this._name, spaceId);
            if (!_.isEmpty(permission)) {
                return Object.assign({}, globalPermission || {}, permission);
            }
        }
        return globalPermission
    }

    async getUserObjectPermission(userSession: SteedosUserSession, rolesFieldsPermission?: any) {

        if (!userSession) {
            throw new Error('userSession is required')
        }

        // yupeng: 一个用户可能有多个角色，这里返回一个列表
        let roles = userSession.roles
        let objectRolesPermission = this.getObjectRolesPermission(userSession.spaceId)

        let userObjectPermission = {
            allowRead: false,
            allowCreate: false,
            allowEdit: false,
            allowDelete: false,
            viewAllRecords: false,
            modifyAllRecords: false,
            viewCompanyRecords: false,
            modifyCompanyRecords: false,
            allowReadFiles: null,
            viewAllFiles: null,
            allowCreateFiles: null,
            allowEditFiles: null,
            allowDeleteFiles: null,
            modifyAllFiles: null,
            disabled_list_views: null,
            disabled_actions: null,
            unreadable_fields: null,
            uneditable_fields: null,
            unrelated_objects: null,
            field_permissions: null,
            viewAssignCompanysRecords: [],
            modifyAssignCompanysRecords: [],
            // read_filters: [],
            // edit_filters: []
        }

        if (_.isEmpty(roles)) {
            throw new Error('not find user permission');
        }

        if (!rolesFieldsPermission) {
            rolesFieldsPermission = await FieldPermission.getObjectFieldsPermissionGroupRole(this.name);
        }

        // yupeng: 对于当前用户所属的每个角色，判断对该对象权限
        roles.forEach((role) => {
            let rolePermission = objectRolesPermission[role];
            if (rolePermission) {
                let roleFieldsPermission = rolesFieldsPermission[role];
                _.each(userObjectPermission, (v, k) => {
                    let _v = rolePermission[k];
                    if (k === 'field_permissions') {
                        _v = roleFieldsPermission
                    }
                    if (_.isBoolean(v)) {
                        if (v === false && _v === true) {
                            userObjectPermission[k] = _v
                        }
                    } else if (['allowReadFiles','viewAllFiles','allowCreateFiles','allowEditFiles','allowDeleteFiles','modifyAllFiles'].indexOf(k) > -1){
                        if(_.isBoolean(_v)){
                            userObjectPermission[k] = _v
                        }
                    } else if (['read_filters', 'edit_filters'].indexOf(k) > -1) {
                        if ('edit_filters' === k) {
                            if (!_.isEmpty(_v)) {
                                userObjectPermission['read_filters'].push(_v);
                            }
                        }
                        if (!_.isEmpty(_v)) {
                            userObjectPermission[k].push(_v);
                        }
                    } else if (['viewAssignCompanysRecords', 'modifyAssignCompanysRecords'].indexOf(k) > -1) {
                        if ('modifyAssignCompanysRecords' === k) {
                            if (!_.isEmpty(_v) && _.isArray(_v)) {
                                userObjectPermission['viewAssignCompanysRecords'].push(..._v);
                            }
                        }
                        if (!_.isEmpty(_v) && _.isArray(_v)) {
                            userObjectPermission[k].push(..._v);
                        }
                    }
                    else if ((_.isArray(v) || _.isNull(v))) {
                        if (!_.isArray(_v)) {
                            _v = []
                        }
                        if (_.isNull(v)) {
                            userObjectPermission[k] = _v
                        } else {
                            if (k === 'field_permissions') {
                                userObjectPermission[k] = _.union(v, _v)
                            } else {
                                userObjectPermission[k] = _.intersection(v, _v)
                            }
                        }
                    }
                })
            }
        });

        // yupeng: 判断字段权限
        const field_permissions = {};
        if (userObjectPermission.field_permissions) {
            _.each(userObjectPermission.field_permissions, (field_permission) => {
                const { field, read, edit } = field_permission;
                if (field_permissions[field]) {
                    field_permissions[field].edit = field_permissions[field].edit || edit;
                    if (field_permissions[field].edit) {
                        field_permissions[field].read = true
                    } else {
                        field_permissions[field].read = field_permissions[field].read || read;
                    }
                } else {
                    field_permissions[field] = {
                        field: field,
                        read: edit || read,
                        edit: edit
                    }
                }
            })
        }

        userObjectPermission.field_permissions = field_permissions;

        userObjectPermission.disabled_list_views = userObjectPermission.disabled_list_views || []
        userObjectPermission.disabled_actions = userObjectPermission.disabled_actions || []
        userObjectPermission.unreadable_fields = userObjectPermission.unreadable_fields || []
        userObjectPermission.uneditable_fields = userObjectPermission.uneditable_fields || []
        userObjectPermission.unrelated_objects = userObjectPermission.unrelated_objects || []

        let spaceId = userSession.spaceId
        if (isTemplateSpace(spaceId)) {
            return Object.assign({}, userObjectPermission, { allowRead: true, viewAllRecords: true, viewCompanyRecords: true })
        }

        return userObjectPermission;
    }

    private async allowFind(userSession: SteedosUserSession) {
        if (!userSession)
            return true
        let userObjectPermission = await this.getUserObjectPermission(userSession)
        if (userObjectPermission.allowRead) {
            return true
        } else {
            return false
        }
    }

    private async allowInsert(userSession: SteedosUserSession) {
        if (!userSession)
            return true
        let userObjectPermission = await this.getUserObjectPermission(userSession)
        if (userObjectPermission.allowCreate) {
            return true
        } else {
            return false
        }
    }

    private async allowUpdate(userSession: SteedosUserSession) {
        if (!userSession)
            return true
        let userObjectPermission = await this.getUserObjectPermission(userSession)
        if (userObjectPermission.allowEdit) {
            return true
        } else {
            return false
        }
    }

    private async allowDelete(userSession: SteedosUserSession) {
        if (!userSession)
            return true
        let userObjectPermission = await this.getUserObjectPermission(userSession)
        if (userObjectPermission.allowDelete) {
            return true
        } else {
            return false
        }
    }

    async find(query: SteedosQueryOptions, userSession?: SteedosUserSession) {
        let clonedQuery = Object.assign({}, query);
        await this.processUnreadableField(userSession, clonedQuery);
        return await this.callAdapter('find', this.table_name, clonedQuery, userSession)
    }

    // 此函数支持driver: MeteorMongo
    async aggregate(query: SteedosQueryOptions, externalPipeline, userSession?: SteedosUserSession) {
        let clonedQuery = Object.assign({}, query);

        // yupeng: 根据 userSession 的权限，过滤掉不可读取的字段
        await this.processUnreadableField(userSession, clonedQuery);

        // yupeng: callAdapter 实际去执行校验规则、操作数据库、执行触发器脚本
        return await this.callAdapter('aggregate', this.table_name, clonedQuery, externalPipeline, userSession)
    }

    // 此函数支持driver: MeteorMongo
    async directAggregate(query: SteedosQueryOptions, externalPipeline: any[], userSession?: SteedosUserSession) {
        let clonedQuery = Object.assign({}, query);
        await this.processUnreadableField(userSession, clonedQuery);
        return await this.callAdapter('directAggregate', this.table_name, clonedQuery, externalPipeline, userSession)
    }

    // 此函数支持driver: MeteorMongo，类似于aggregate，其参数externalPipeline放在最前面而已
    async directAggregatePrefixalPipeline(query: SteedosQueryOptions, prefixalPipeline: any[], userSession?: SteedosUserSession) {
        let clonedQuery = Object.assign({}, query);
        await this.processUnreadableField(userSession, clonedQuery);
        return await this.callAdapter('directAggregatePrefixalPipeline', this.table_name, clonedQuery, prefixalPipeline, userSession)
    }

    async findOne(id: SteedosIDType, query: SteedosQueryOptions, userSession?: SteedosUserSession) {
        let clonedQuery = Object.assign({}, query);
        await this.processUnreadableField(userSession, clonedQuery);
        return await this.callAdapter('findOne', this.table_name, id, clonedQuery, userSession)
    }

    async insert(doc: Dictionary<any>, userSession?: SteedosUserSession) {
        return await this.callAdapter('insert', this.table_name, doc, userSession)
    }

    async update(id: SteedosIDType, doc: Dictionary<any>, userSession?: SteedosUserSession) {
        await this.processUneditableFields(userSession, doc)
        let clonedId = id;
        return await this.callAdapter('update', this.table_name, clonedId, doc, userSession)
    }

    async updateOne(id: SteedosIDType, doc: Dictionary<any>, userSession?: SteedosUserSession) {
        await this.processUneditableFields(userSession, doc)
        let clonedId = id;
        return await this.callAdapter('updateOne', this.table_name, clonedId, doc, userSession)
    }
    // 此函数支持driver: MeteorMongo、Mongo
    async updateMany(queryFilters: SteedosQueryFilters, doc: Dictionary<any>, userSession?: SteedosUserSession) {
        await this.processUneditableFields(userSession, doc)
        let clonedQueryFilters = queryFilters;
        return await this.callAdapter('updateMany', this.table_name, clonedQueryFilters, doc, userSession)
    }

    async delete(id: SteedosIDType, userSession?: SteedosUserSession) {
        let clonedId = id;
        return await this.callAdapter('delete', this.table_name, clonedId, userSession)
    }

    async directFind(query: SteedosQueryOptions, userSession?: SteedosUserSession) {
        let clonedQuery = Object.assign({}, query);
        await this.processUnreadableField(userSession, clonedQuery);
        return await this.callAdapter('directFind', this.table_name, clonedQuery, userSession)
    }

    async directInsert(doc: Dictionary<any>, userSession?: SteedosUserSession) {
        return await this.callAdapter('directInsert', this.table_name, doc, userSession)
    }

    async directUpdate(id: SteedosIDType, doc: Dictionary<any>, userSession?: SteedosUserSession) {
        await this.processUneditableFields(userSession, doc)
        let clonedId = id;
        return await this.callAdapter('directUpdate', this.table_name, clonedId, doc, userSession)
    }

    async directDelete(id: SteedosIDType, userSession?: SteedosUserSession) {
        let clonedId = id;
        return await this.callAdapter('directDelete', this.table_name, clonedId, userSession)
    }

    async _makeNewID(){
        return await this._datasource._makeNewID(this.table_name);
    }

    async getFirstListView(){
        return this.list_views[0];
    }

    async getAbsoluteUrl(app_id, record_id?){
        const object_name = this.name;
        const list_view:any = await this.getFirstListView();
        const list_view_id = list_view ? list_view._id || list_view.name : 'all'
        if(record_id)
            return absoluteUrl("/app/" + app_id + "/" + object_name + "/view/" + record_id)
        else{
            if(object_name === 'meeting'){
                return absoluteUrl("/app/" + app_id + "/" + object_name + "/calendar/")
            }else{
                return absoluteUrl("/app/" + app_id + "/" + object_name + "/grid/" + list_view_id)
            }
        }
    }

    async getRecordAbsoluteUrl(app_id, record_id){
        return await this.getAbsoluteUrl(app_id, record_id)
    }

    async getGridAbsoluteUrl(app_id){
        return await this.getAbsoluteUrl(app_id)
    }

    async isEnableAudit(){
        return this.enable_audit;
    }

    async getDetails(){
        return await this.callMetadataObjectServiceAction(`getDetails`, {objectApiName: this.name});
    }

    async getMasters(){
        return await this.callMetadataObjectServiceAction(`getMasters`, {objectApiName: this.name});
    }

    async getLookupDetails(){
        return await this.callMetadataObjectServiceAction(`getLookupDetails`, {objectApiName: this.name});
    }

    async getDetailsInfo(){
        return await this.callMetadataObjectServiceAction(`getDetailsInfo`, {objectApiName: this.name});
    }

    async getMastersInfo(){
        return await this.callMetadataObjectServiceAction(`getMastersInfo`, {objectApiName: this.name});
    }

    async getLookupDetailsInfo(){
        return await this.callMetadataObjectServiceAction(`getLookupDetailsInfo`, {objectApiName: this.name});
    }

    /**
     * 此函数返回getDetailsInfo、getMastersInfo、getLookupDetailsInfo 3个请求的结果，用于优化访问速度
     */
    async getRelationsInfo() {
        return await this.callMetadataObjectServiceAction(`getRelationsInfo`, { objectApiName: this.name });
    }

    async getRecordPermissions(record, userSession){
        const permissions = await this.getUserObjectPermission(userSession);
        const { userId, company_ids: user_company_ids } = userSession;
        if(record){
            if(record.record_permissions){
                return record.record_permissions
            }
            let recordOwnerId = record.owner;
            if(_.isObject(recordOwnerId)){
                recordOwnerId = recordOwnerId._id;
            }
            const isOwner = recordOwnerId == userId;
            let record_company_id = record.company_id;
            if(record_company_id && _.isObject(record_company_id) && record_company_id._id){
                record_company_id = record_company_id._id;
            }
            let record_company_ids = record.company_ids;
            if(record_company_ids && record_company_ids.length && _.isObject(record_company_ids[0])){
                record_company_ids = record_company_ids.map((n)=> n._id)
            }
            record_company_ids = _.union(record_company_ids, [record_company_id]);
            record_company_ids = _.compact(record_company_ids);
            if(!permissions.modifyAllRecords && !isOwner && !permissions.modifyCompanyRecords){
                permissions.allowEdit = false
			    permissions.allowDelete = false
            }else if(!permissions.modifyAllRecords && permissions.modifyCompanyRecords){
                if(record_company_ids && record_company_ids.length){
                    if(user_company_ids && user_company_ids.length){
                        if(!_.intersection(user_company_ids, record_company_ids).length){
                            permissions.allowEdit = false
						    permissions.allowDelete = false
                        }
                    }else{
                        permissions.allowEdit = false
                        permissions.allowDelete = false
                    }
                }
            }
            if(record.locked && !permissions.modifyAllRecords){
                permissions.allowEdit = false
			    permissions.allowDelete = false
            }
            if(!permissions.viewAllRecords && !isOwner && !permissions.viewCompanyRecords){
                permissions.allowRead = false
            }else if(!permissions.viewAllRecords && permissions.viewCompanyRecords){
                if(record_company_ids && record_company_ids.length){
                    if(user_company_ids && user_company_ids.length){
                        if(!_.intersection(user_company_ids, record_company_ids).length){
                            permissions.allowRead = false
                        }
                    }else{
                        permissions.allowRead = false
                    }
                }
            }
        }
        return permissions
    }

    async getRecordView(userSession, context?: any) {
        let objectConfig;
        let layouts;
        let spaceProcessDefinition;
        let dbListViews;
        let rolesFieldsPermission;

        if (context) {
            objectConfig = context.objectConfig;
            layouts = context.layouts;
            spaceProcessDefinition = context.spaceProcessDefinition;
            dbListViews = context.dbListViews;
            rolesFieldsPermission = context.rolesFieldsPermission;
        }

        const lng = userSession.language;
        if (!objectConfig) {
            const objectMetadataConfig: any = await this.callMetadataObjectServiceAction('get', { objectApiName: this.name });
            objectConfig = objectMetadataConfig.metadata;
        }
        objectConfig.name = this.name
        objectConfig.datasource = this.datasource.name;
        objectConfig.permissions = await this.getUserObjectPermission(userSession, rolesFieldsPermission);
        const relationsInfo = await this.getRelationsInfo();
        objectConfig.details = relationsInfo.details;
        objectConfig.masters = relationsInfo.masters;
        objectConfig.lookup_details = relationsInfo.lookup_details;
        delete objectConfig.db

        translationObject(lng, objectConfig.name, objectConfig, true);
        if (!layouts) {
            layouts = await getObjectLayouts(userSession.profile, userSession.spaceId, this.name);
        }
        if(layouts && layouts.length > 0){
            const layout = layouts[0];
            let _fields = {};
            let sort_no = 1;
            _.each(layout.fields, function(_item){
                _fields[_item.field_name] = objectConfig.fields[_item.field_name]
                if(_fields[_item.field_name]){
                    if(_.has(_item, 'group')){
                        _fields[_item.field_name].group = _item.group
                    }
                    
                    if(_item.is_required){
                        _fields[_item.field_name].readonly = false
                        _fields[_item.field_name].disabled = false
                        _fields[_item.field_name].required = true
                    }else if(_item.is_readonly){
                        _fields[_item.field_name].readonly = true
                        _fields[_item.field_name].disabled = true
                        _fields[_item.field_name].required = false
                    }

                    if(_item.visible_on){
                        _fields[_item.field_name].visible_on = _item.visible_on
                    }

                    if(['created','created_by','modified','modified_by'].indexOf(_item.field_name) < 0){
                        _fields[_item.field_name].omit = false;
                        _fields[_item.field_name].hidden = false;
                    }

                    _fields[_item.field_name].sort_no = sort_no;
                    sort_no++;
                }
            })

            const layoutFieldKeys = _.keys(_fields);
            const objectFieldKeys = _.keys(objectConfig.fields);

            const difference = _.difference(objectFieldKeys, layoutFieldKeys);

            _.each(layoutFieldKeys, function(fieldApiName){
                objectConfig.fields[fieldApiName] = _fields[fieldApiName];
            })
            
            _.each(difference, function(fieldApiName){
                objectConfig.fields[fieldApiName].hidden = true;
                objectConfig.fields[fieldApiName].sort_no = 99999;
            })

            _.each(layout.buttons, function(button){
                const action = objectConfig.actions[button.button_name];
                if(action){
                    if(button.visible_on){
                        action._visible = button.visible_on;
                    }
                }
            })
    
            const layoutButtonsName = _.pluck(layout.buttons,'button_name');
            _.each(objectConfig.actions, function(action){
                if(!_.include(layoutButtonsName, action.name)){
                    action.visible = false
                    action._visible = function(){return false}.toString()
                }
            })
            // _object.allow_customActions = userObjectLayout.custom_actions || []
            // _object.exclude_actions = userObjectLayout.exclude_actions || []
            objectConfig.related_lists = layout.related_lists || []
            _.each(objectConfig.related_lists, (related_list)=>{
                if(related_list.sort_field_name && _.isArray(related_list.sort_field_name) && related_list.sort_field_name.length > 0){
                    related_list.sort = [];
                    _.each(related_list.sort_field_name, (fName)=>{
                        related_list.sort.push({field_name: fName, order: related_list.sort_order || 'asc'})
                    })
                }
            })
        }

        // 使用字段级安全性作为限制用户对字段的访问权限的手段；然后使用页面布局主要在选项卡中组织详细信息和编辑页面。这可以减少需要维护的页面布局数量。
        // 例如，如果字段在页面布局中是必需的，并且在字段级安全性设置中是只读的，则字段级安全性将覆盖页面布局，并且该字段将对用户是只读的。
        const userObjectFields = objectConfig.fields;
        _.each(objectConfig.permissions.field_permissions, (field_permission, field) => {
            const { read, edit } = field_permission;
            if (userObjectFields[field]) {
                if (read) {
                    userObjectFields[field].hidden = false;
                    userObjectFields[field].omit = true;
                    userObjectFields[field].readonly = true;
                    userObjectFields[field].disabled = true;
                }
                if (edit) {
                    userObjectFields[field].omit = false;
                    userObjectFields[field].hidden = false;
                    userObjectFields[field].readonly = false;
                    userObjectFields[field].disabled = false;
                }
                if (!read && !edit) {
                    delete userObjectFields[field]
                }
            }
        })

        objectConfig.fields = userObjectFields

        // TODO object layout 是否需要控制审批记录显示？
        if (!spaceProcessDefinition) {
            spaceProcessDefinition = await getObject("process_definition").directFind({ filters: [['space', '=', userSession.spaceId], ['object_name', '=', this.name], ['active', '=', true]] })
        }
        if (spaceProcessDefinition.length > 0) {
            objectConfig.enable_process = true
        }

        //清理数据

        _.each(objectConfig.triggers, function(trigger, key){
            if(trigger?.on != 'client'){
                delete objectConfig.triggers[key];
            }
        })
        if (!dbListViews) {
            dbListViews = await getObject("object_listviews").directFind({ filters: [['space', '=', userSession.spaceId], ['object_name', '=', this.name], [['owner', '=', userSession.userId], 'or', ['shared', '=', true]]] })
        }
        objectConfig.list_views = Object.assign({}, objectConfig.list_views)
        _.each(dbListViews, function(dbListView){
            delete dbListView.created;
            delete dbListView.created_by;
            delete dbListView.modified;
            delete dbListView.modified_by;
            objectConfig.list_views[dbListView.name] = dbListView;
        })
        delete objectConfig.listeners
        delete objectConfig.__filename
        delete objectConfig.extend
        return objectConfig;
    }

    async getDefaulRecordView(userSession){
        const object_name = this.name;
        const type = 'record';
        const buttons = [];
        const fields = []; 
        const related_lists = [];

        const objectConfig: any = await this.callMetadataObjectServiceAction('getOriginalObject', {objectApiName: this.name});
        let sortedFields = [];
        forEach(objectConfig.fields, (fieldItem, key)=>{
            sortedFields.push(Object.assign({}, {name: key}, fieldItem));
        });
        sortedFields = sortBy(sortedFields, function(o) { return o.sort_no; });
        _.each(sortedFields, function(field, key){
            const layoutField: any = {};
            layoutField.field_name = field.name;
            layoutField.is_readonly = field.readonly;
            layoutField.is_required = field.required;
            layoutField.group = field.group;
            // layoutField.visible_on = `${!field.hidden}`;
            fields.push(layoutField);
        });

        let relatedLists = []
        if(this.enable_files){
            relatedLists.push("cms_files.parent")
        }

        const details = await this.getDetailsInfo();
        const lookup_details = await this.getLookupDetailsInfo();
        relatedLists = relatedLists.concat(_.union(details, lookup_details));

        if(this.enable_tasks){
            relatedLists.push("tasks.related_to")
        }
        if(this.enable_notes){
            relatedLists.push("notes.related_to")
        }
        if(this.enable_events){
            relatedLists.push("events.related_to")
        }
        if(this.enable_instances){
            relatedLists.push("instances.record_ids")
        }
        if(this.enable_approvals){
            relatedLists.push("approvals.related_to")
        }
        if(this.enable_process){
            relatedLists.push("process_instance_history.target_object")
        }
        for await (const related of relatedLists) {
            if(related){
                const relatedItem: any = {}
                relatedItem.related_field_fullname = related;
                let foo = (related as any).split('.');
                let rObjectName = foo[0];

                const relatedObject = await getObject(rObjectName).toConfig();
                const relatedObjectAllListView = _.find(relatedObject.list_views, function(listview){
                    return listview.name === 'all'
                })

                if(relatedObjectAllListView && relatedObjectAllListView.columns){
                    const fieldNames = [];
                    _.each(relatedObjectAllListView.columns, (column)=>{
                        if(_.isString(column)){
                            fieldNames.push(column);
                        }else if(_.isObject(column)){
                            fieldNames.push(column.field);
                        }
                    })

                    relatedItem.field_names = fieldNames
                }
                related_lists.push(relatedItem)
            }
        }

        buttons.push({
            button_name: 'standard_new'
        })

        buttons.push({
            button_name: 'standard_edit'
        })

        buttons.push({
            button_name: 'standard_delete'
        })

        _.each(objectConfig.actions, function(action, key){
            if(action.is_enable){
                buttons.push({
                    button_name: action.name
                })
            }
        });

        return {
            object_name, type, buttons, fields, related_lists,
            space: userSession.spaceId
        }
    }

    async createDefaulRecordView(userSession){
        const name = 'default';
        const label = 'Default';
        const profiles = ['user'];
        try {
            let defaultRecordView = await this.getDefaulRecordView(userSession);
            return await getObject('object_layouts').insert(Object.assign({},defaultRecordView, {name, label, profiles}), userSession)
        } catch (error) {
            return {error: error.message}
        }
    }

    async getRelateds(){
        const related_objects = [];
        if(this.enable_files){
            related_objects.push({object_name:"cms_files", foreign_key: "parent"})
        }
        let detailsInfo = await this.getDetailsInfo();
        let lookupsInfo = await this.getLookupDetailsInfo();
        let relatedInfos = detailsInfo.concat(lookupsInfo);
        for (const info of relatedInfos) {
            if (!info.startsWith('__')) {
                let infos = info.split('.');
                let detailObjectApiName = infos[0];
                let detailFieldName = infos[1];
                let related_field = await getObject(detailObjectApiName).getField(detailFieldName);
                if(related_field){
                    if((related_field.type == "master_detail" || (related_field.type == "lookup" && related_field.relatedList)) && related_field.reference_to && related_field.reference_to == this.name){
                        if(detailObjectApiName == "object_fields"){
                            related_objects.splice(0, 0, {object_name: detailObjectApiName, foreign_key: detailFieldName})
                        }else{
                            related_objects.push({object_name:detailObjectApiName, foreign_key: detailFieldName, write_requires_master_read: related_field.write_requires_master_read})
                        }
                    }
                }
            }
        }
        if(this.enable_tasks){
            related_objects.push({object_name:"tasks", foreign_key: "related_to"})
        }
        if(this.enable_notes){
            related_objects.push({object_name:"notes", foreign_key: "related_to"})
        }
        if(this.enable_events){
            related_objects.push({object_name:"events", foreign_key: "related_to"});
        }
        if(this.enable_instances){
            related_objects.push({object_name:"instances", foreign_key: "record_ids"})
        }
            
        if(this.enable_approvals){
            related_objects.push({object_name:"approvals", foreign_key: "related_to"})
        }
            
        if(this.enable_process){
            related_objects.push({object_name:"process_instance_history", foreign_key: "target_object"})
        }
        return related_objects;
    }

    private isDirectCRUD(methodName: string) {
        return methodName.startsWith("direct");
    }


    async count(query: SteedosQueryOptions, userSession?: SteedosUserSession) {
        let clonedQuery = Object.assign({}, query);
        return await this.callAdapter('count', this.table_name, clonedQuery, userSession)
    }

    private async allow(method: string, userSession: SteedosUserSession) {
        if (_.isNull(userSession) || _.isUndefined(userSession)) {
            return true
        }
        if (method === 'find' || method === 'findOne' || method === 'count' || method === 'aggregate' || method === 'aggregatePrefixalPipeline') {
            return await this.allowFind(userSession)
        } else if (method === 'insert') {
            return await this.allowInsert(userSession)
        } else if (method === 'update' || method === 'updateOne' || method === 'updateMany') {
            return await this.allowUpdate(userSession)
        } else if (method === 'delete') {
            return await this.allowDelete(userSession)
        }
    }

    private async runBeforeTriggers(method: string, context: SteedosTriggerContextConfig) {
        if (method === 'count' || method === "findOne") {
            method = 'find';
        }
        let meteorWhen = `before${method.charAt(0).toLocaleUpperCase()}${_.rest([...method]).join('')}`
        let when = `before.${method}`;
        await this.runTriggers(meteorWhen, context);
        return await this.runTriggerActions(when, context)
    }

    private async runAfterTriggers(method: string, context: SteedosTriggerContextConfig) {
        let meteorWhen = `after${method.charAt(0).toLocaleUpperCase()}${_.rest([...method]).join('')}`
        let when = `after.${method}`;
        await this.runTriggers(meteorWhen, context);
        return await this.runTriggerActions(when, context)
    }

    private async appendRecordPermission(records, userSession) {
        const _ids = _.pluck(records, '_id');
        const objPm = await this.getUserObjectPermission(userSession);
        const permissionFilters = this.getObjectEditPermissionFilters(objPm, userSession);
        if (_.isEmpty(permissionFilters)) {
            return;
        }
        const filters = formatFiltersToODataQuery(['_id', 'in', _ids])

        const results = await this.directFind({
            fields: ['_id'],
            filters: `(${filters}) and (${permissionFilters.join(' or ')})`
        });
        const allowEditIds = _.pluck(results, '_id');
        _.each(records, (record) => {
            if (_.include(allowEditIds, record._id)) {
                record.record_permissions = {
                    allowRead: true,
                    allowEdit: true,
                    allowDelete: true,
                }
            }
        })

    }

    private async getTriggerContext(when: string, method: string, args: any[], recordId?: string) {

        let userSession = args[args.length - 1]

        let context: SteedosTriggerContextConfig = { objectName: this.name, userId: userSession ? userSession.userId : undefined, spaceId: userSession ? userSession.spaceId : undefined }

        if (method === 'find' || method === 'findOne' || method === 'count') {
            context.query = args[args.length - 2]
        }

        if (method === 'aggregate' || method === 'aggregatePrefixalPipeline') {
            context.query = args[args.length - 3]
        }

        if (method === 'findOne' || method === 'update' || method === 'delete') {
            context.id = args[1]
        }

        if (method === 'insert' || method === 'update') {
            context.doc = args[args.length - 2]
        }

        if (when === 'after' && (method === 'update' || method === 'delete')) {
            context.previousDoc = await this.findOne(recordId, {}, userSession)
        }

        return context
    }

    private async processUnreadableField(userSession: SteedosUserSession, query: SteedosQueryOptions) {
        if (!userSession) {
            return
        }
        let userObjectPermission = await this.getUserObjectPermission(userSession)
        let userObjectUnreadableFields = userObjectPermission.unreadable_fields
        if (userObjectUnreadableFields.length > 0) {
            let queryFields = [];

            if (_.isArray(query.fields)) {
                queryFields = query.fields
            } else if (_.isString(query.fields)) {
                queryFields = query.fields.split(',')
            }

            if (!(query.fields && query.fields.length)) {
                queryFields = _.keys(this.toConfig().fields)
                _.each(queryFields, function (fieldName, index) {
                    if (fieldName && fieldName.indexOf("$") > -1) {
                        delete queryFields[index];
                    }
                })
                queryFields = _.compact(queryFields)
            }
            queryFields = _.difference(queryFields, userObjectUnreadableFields)

            if (queryFields.length < 1) {
                queryFields.push()
            }

            if (this.idFieldName) {
                queryFields.unshift(this.idFieldName)
                queryFields = _.compact(_.uniq(queryFields))
            }

            query.fields = queryFields.join(',')
        }
    }

    private async processUneditableFields(userSession: SteedosUserSession, doc: JsonMap) {
        // 后台直接去掉uneditable_fields相关判断逻辑
        // [签约对象同时配置了company_ids必填及uneditable_fields造成部分用户新建签约对象时报错 #192](https://github.com/steedos/steedos-project-dzug/issues/192)
        // if (!userSession) {
        //     return
        // }

        // let userObjectPermission = await this.getUserObjectPermission(userSession)
        // let userObjectUneditableFields = userObjectPermission.uneditable_fields

        // let intersection = _.intersection(userObjectUneditableFields, _.keys(doc))
        // if (intersection.length > 0) {
        //     throw new Error(`no permissions to edit fields ${intersection.join(', ')}`)
        // }

        // // _.each(userObjectUneditableFields, (name: string)=>{
        // //     delete doc[name]
        // // })
    }

    private async callAdapter(method: string, ...args: any[]) {

        // yupeng: 判断该 method 是否是 _datasource 的一个方法（function）
        // yupeng: 我们的例子中 adapterMethod = "aggregate"
        const adapterMethod = this._datasource[method];
        if (typeof adapterMethod !== 'function') {
            throw new Error('Adapted does not support "' + method + '" method');
        }

        // yupeng: args[args.length - 1] 表示最后一个参数，这里要求调用者传参是最后一个参数必须传 userSession
        // yupeng: 判断用户是否有执行该方法的权限
        let allow = await this.allow(method, args[args.length - 1])
        if (!allow) {
            throw new Error('not find permission')
        }

        let objectName = args[0], recordId: string, doc: JsonMap;
        if (["insert", "update", "updateMany", "delete"].indexOf(method) > -1) {
            // 因下面的代码，比如函数dealWithMethodPermission可能改写args变量，所以需要提前从args取出对应变量值。
            if (method === "insert") {
                // 此处doc不带_id值，得执行完adapterMethod.apply后，doc中才有_id属性，所以这里的doc及recordId都不准确
                doc = args[1];
                recordId = <string>doc._id;
            }
            else {
                recordId = args[1];
                doc = args[2];
            }
        }

        let paramRecordId; // 用于记录原始的id参数值
        if (method === 'findOne' || method === 'update' || method === 'delete') {
            paramRecordId = args[1];
        }

        // 判断处理工作区权限，公司级权限，owner权限
        if (this._datasource.enable_space) {
            this.dealWithFilters(method, args);
            await this.dealWithMethodPermission(method, args);
        }

        let returnValue: any;
        let userSession: SteedosUserSession;

        // directCURD 不考虑执行触发器逻辑
        if (this.isDirectCRUD(method)) {
            userSession = args[args.length - 1]
            args.splice(args.length - 1, 1, userSession ? userSession.userId : undefined)
            returnValue = await adapterMethod.apply(this._datasource, args);
        } else {
            userSession = args[args.length - 1]

            // yupeng: 这里执行 beforeTrigger 脚本
            let beforeTriggerContext = await this.getTriggerContext('before', method, args)
            if (paramRecordId) {
                beforeTriggerContext = Object.assign({} , beforeTriggerContext, { id: paramRecordId });
            }
            await this.runBeforeTriggers(method, beforeTriggerContext)

            // yupeng：这里执行校验规则
            await runValidationRules(method, beforeTriggerContext, args[0], userSession)

            // yupeng: 这里获取 afterTrigger 上下文
            let afterTriggerContext = await this.getTriggerContext('after', method, args, paramRecordId)
            if (paramRecordId) {
                afterTriggerContext = Object.assign({}, afterTriggerContext, { id: paramRecordId });
            }
            let previousDoc = clone(afterTriggerContext.previousDoc);
            args.splice(args.length - 1, 1, userSession ? userSession.userId : undefined)

            // yupeng：这里调用 this._datasource 的方法如 aggregate 操作数据库，参数为 args
            returnValue = await adapterMethod.apply(this._datasource, args);
            if (method === 'find' || method == 'findOne' || method == 'count' || method == 'aggregate' || method == 'aggregatePrefixalPipeline') {
                let values = returnValue || {}
                if (method === 'count') {
                    values = returnValue || 0
                } 
                else {
                    if (userSession) {
                        let _records = returnValue
                        if (method == 'findOne' && returnValue) {
                            _records = [_records]
                        }
                        await this.appendRecordPermission(_records, userSession);
                    }
                }
                Object.assign(afterTriggerContext, { data: { values: values } })
            }
            // yupeng：执行 afterTrigger 脚本
            if(method == 'insert' && _.has(returnValue, '_id')){
                afterTriggerContext.doc = returnValue;
                afterTriggerContext = Object.assign({}, afterTriggerContext, { id: returnValue._id });
            }
            if (method == "update") {
                if (returnValue) {
                    afterTriggerContext.doc = returnValue;
                    await this.runAfterTriggers(method, afterTriggerContext)
                }
            }
            else {
                await this.runAfterTriggers(method, afterTriggerContext)
            }
            if (method === 'find' || method == 'findOne' || method == 'count' || method == 'aggregate' || method == 'aggregatePrefixalPipeline') {
                if (_.isEmpty(afterTriggerContext.data) || (_.isEmpty(afterTriggerContext.data.values) && !_.isNumber(afterTriggerContext.data.values))) {
                    return returnValue
                } else {
                    return afterTriggerContext.data.values
                }
            }
            await new WorkflowRulesRunner({
                object_name: this.name,
                event: method,
                record: returnValue,
                user_session: userSession,
                previous_record: afterTriggerContext.previousDoc
            }).run();
            if (returnValue) {
                if (method === "insert") {
                    // 当为insert时，上面代码执行后的doc不带_id，只能从returnValue中取
                    doc = returnValue;
                    recordId = <string>doc._id;
                }
                // 一定要先运行公式再运行汇总，以下两个函数顺序不能反

                // yupeng：操作对象上可能有的公式字段
                await this.runRecordFormula(method, objectName, recordId, doc, userSession);
                await this.runRecordSummaries(method, objectName, recordId, doc, previousDoc, userSession);
            }
            await brokeEmitEvents(objectName, method, afterTriggerContext);
        }
        return returnValue
    };

    private async runRecordFormula(method: string, objectName: string, recordId: string, doc: any, userSession: any) {
        if (["insert", "update", "updateMany"].indexOf(method) > -1) {
            if (method === "updateMany") {
                // TODO:暂时不支持updateMany公式计算，因为拿不到修改了哪些数据
                // let filters: SteedosQueryFilters = args[1];
                // await runManyCurrentObjectFieldFormulas(objectName, filters, userSession);
            }
            else {
                let currentUserId = userSession ? userSession.userId : undefined;
                await runCurrentObjectFieldFormulas(objectName, recordId, doc, currentUserId, true);
                if (method === "update") {
                    // 新建记录时肯定不会有字段被引用，不需要重算被引用的公式字段值
                    await runQuotedByObjectFieldFormulas(objectName, recordId, userSession);
                }
            }
        }
    }

    private async runRecordSummaries(method: string, objectName: string, recordId: string, doc: any, previousDoc: any, userSession: any) {
        if (["insert", "update", "updateMany", "delete"].indexOf(method) > -1) {
            if (method === "updateMany") {
                // TODO:暂时不支持updateMany汇总计算，因为拿不到修改了哪些数据
            }
            else {
                if (method === "insert") {
                    await runCurrentObjectFieldSummaries(objectName, recordId);
                }
                await runQuotedByObjectFieldSummaries(objectName, recordId, previousDoc, userSession);
            }
        }
    }

    private getObjectEditPermissionFilters(objectPermission, userSession) {
        const objectPermissionFilters = [];
        if (!_.isEmpty(objectPermission.modifyAssignCompanysRecords)) {
            objectPermissionFilters.push(`(${formatFiltersToODataQuery([['company_id', 'in', objectPermission.modifyAssignCompanysRecords], 'or', ['company_ids', 'in', objectPermission.modifyAssignCompanysRecords]], userSession)})`)
        }
        return objectPermissionFilters;
    }

    /**
     * 把query.filters用formatFiltersToODataQuery转为odata query
     * 主要是为了把userSession中的utcOffset逻辑传入formatFiltersToODataQuery函数处理
     */
    private dealWithFilters(method: string, args: any[]) {
        let userSession = args[args.length - 1];
        if (userSession) {
            if (method === 'find' || method === 'count' || method === 'aggregate' || method === 'aggregatePrefixalPipeline') {
                let query = args[args.length - 2];
                if (method === 'aggregate' || method === 'aggregatePrefixalPipeline') {
                    query = args[args.length - 3];
                }
                if (query.filters && !_.isString(query.filters)) {
                    query.filters = formatFiltersToODataQuery(query.filters, userSession);
                }
            }
        }
    }

    private async dealWithMethodPermission(method: string, args: any[]) {
        let userSession = args[args.length - 1];
        if (userSession) {
            let spaceId = userSession.spaceId;
            let userId = userSession.userId;
            let objPm = await this.getUserObjectPermission(userSession);
            if (method === 'find' || method === 'count' || method === 'findOne' || method === 'aggregate' || method === 'aggregatePrefixalPipeline') {
                let query = args[args.length - 2];
                if (method === 'aggregate' || method === 'aggregatePrefixalPipeline') {
                    query = args[args.length - 3];
                }
                if (query.filters && !_.isString(query.filters)) {
                    query.filters = formatFiltersToODataQuery(query.filters);
                }

                if (this.table_name == 'cfs.files.filerecord' || this.table_name == 'cfs.instances.filerecord') {
                    return;
                }

                if (isCloudAdminSpace(spaceId)) {
                    return
                }

                let spaceFilter, companyFilter, ownerFilter, sharesFilter, shareRuleFilters, restrictionRuleFilters, clientFilter = query.filters, filters, permissionFilters = [], userFilters = [];

                //space 权限
                if (spaceId) {
                    spaceFilter = `(space eq '${spaceId}')`;
                }

                // 本公司权限
                if (spaceId && !objPm.viewAllRecords && objPm.viewCompanyRecords) { 
                    if (_.isEmpty(userSession.companies)) {
                        console.log('objPm', objPm);
                        throw new Error("user not belong any company!");
                    }
                    companyFilter = _.map(userSession.companies, function (comp: any) {
                        return `(company_id eq '${comp._id}') or (company_ids eq '${comp._id}')`
                    });
                }

                if (!objPm.viewAllRecords && !objPm.viewCompanyRecords && objPm.allowRead) { // owner
                    ownerFilter = `(owner eq '${userId}')`;
                }

                // 指定公司权限
                let viewAssignCompanysRecordsFilter = [];
                if (objPm.viewAssignCompanysRecords) {
                    _.each(objPm.viewAssignCompanysRecords, (assignCompanyId) => {
                        viewAssignCompanysRecordsFilter.push(`((company_id eq '${assignCompanyId}') or (company_ids eq '${assignCompanyId}'))`)
                    })
                }
                if (!_.isEmpty(viewAssignCompanysRecordsFilter)) {
                    permissionFilters.push(`(${viewAssignCompanysRecordsFilter.join(' or ')})`);
                }

                //共享规则
                shareRuleFilters = await ShareRules.getUserObjectFilters(this.name, userSession);

                if (!_.isEmpty(shareRuleFilters)) {
                    permissionFilters.push(`(${shareRuleFilters.join(' or ')})`);
                }

                // 限制规则
                restrictionRuleFilters = await RestrictionRule.getUserObjectFilters(this.name, userSession);

                if (!_.isEmpty(restrictionRuleFilters)) {
                    userFilters.push(`(${restrictionRuleFilters.join(' or ')})`);
                }
                // objectPermissionFilters = this.getObjectPermissionFilters(objPm, userSession, false);

                // if (!_.isEmpty(objectPermissionFilters)) {
                //     permissionFilters.push(`(${objectPermissionFilters.join(' or ')})`);
                // }

                //共享规则(旧)
                sharesFilter = getUserObjectSharesFilters(this.name, userSession);

                if (!_.isEmpty(companyFilter)) {
                    permissionFilters.push(`(${companyFilter.join(' and ')})`);
                }

                if (ownerFilter) {
                    permissionFilters.push(ownerFilter);
                }

                if (!_.isEmpty(sharesFilter)) {
                    permissionFilters.push(`(${sharesFilter.join(' or ')})`);
                }

                if (clientFilter) {
                    userFilters.push(clientFilter);
                }

                if (spaceFilter) {
                    userFilters.push(spaceFilter);
                }

                if (!userSession.is_space_admin && !_.isEmpty(permissionFilters)) {
                    filters = permissionFilters.join(' or ');
                }

                if (!_.isEmpty(userFilters)) {
                    filters = filters ? `(${filters}) and (${userFilters.join(' and ')})` : userFilters.join(' and ')
                }

                query.filters = filters;
            }
            else if (method === 'insert') {
                if (!objPm.allowCreate) {
                    throw new Error(`no ${method} permission!`);
                }
            }
            else if (method === 'update' || method === 'updateOne') {
                const permissionFilters = this.getObjectEditPermissionFilters(objPm, userSession);
                if (!objPm.allowEdit && _.isEmpty(permissionFilters)) {
                    throw new Error(`no ${method} permission!`);
                }
                let objectPermissionEditFilters = '';
                if (!_.isEmpty(permissionFilters)) {
                    objectPermissionEditFilters = ` or (${permissionFilters.join(' or ')})`
                }
                let id = args[args.length - 3];
                if (!objPm.modifyAllRecords && objPm.modifyCompanyRecords) {
                    let companyFilters = _.map(userSession.companies, function (comp: any) {
                        return `(company_id eq '${comp._id}') or (company_ids eq '${comp._id}')`
                    }).join(' or ')
                    if (companyFilters) {
                        if (_.isString(id)) {
                            id = { filters: `(_id eq \'${id}\') and (${companyFilters}${objectPermissionEditFilters})` }
                        }
                        else if (_.isObject(id)) {
                            if (id.filters && !_.isString(id.filters)) {
                                id.filters = formatFiltersToODataQuery(id.filters);
                            }
                            id.filters = id.filters ? `(${id.filters}) and (${companyFilters}${objectPermissionEditFilters})` : `(${companyFilters}${objectPermissionEditFilters})`;
                        }
                    }
                }
                else if (!objPm.modifyAllRecords && !objPm.modifyCompanyRecords && objPm.allowEdit) {
                    if (_.isString(id)) {
                        id = { filters: `(_id eq \'${id}\') and (owner eq \'${userId}\' ${objectPermissionEditFilters})` }
                    }
                    else if (_.isObject(id)) {
                        if (id.filters && !_.isString(id.filters)) {
                            id.filters = formatFiltersToODataQuery(id.filters);
                        }
                        id.filters = id.filters ? `(${id.filters}) and (owner eq \'${userId}\' ${objectPermissionEditFilters})` : `(owner eq \'${userId}\' ${objectPermissionEditFilters})`;
                    }
                } else if (objectPermissionEditFilters) {
                    if (_.isString(id)) {
                        id = { filters: `(_id eq \'${id}\') and (${objectPermissionEditFilters})` }
                    }
                    else if (_.isObject(id)) {
                        if (id.filters && !_.isString(id.filters)) {
                            id.filters = formatFiltersToODataQuery(id.filters);
                        }
                        id.filters = id.filters ? `(${id.filters}) and (${objectPermissionEditFilters})` : `(${objectPermissionEditFilters})`;
                    }
                }
                args[args.length - 3] = id;
            }
            else if (method === 'updateMany') {
                if (!objPm.modifyAllRecords && !objPm.modifyCompanyRecords) {
                    throw new Error(`no ${method} permission!`);
                }
                if (!objPm.modifyAllRecords && objPm.modifyCompanyRecords) {
                    let queryFilters = args[args.length - 3];
                    let companyFilters = _.map(userSession.companies, function (comp: any) {
                        return `(company_id eq '${comp._id}') or (company_ids eq '${comp._id}')`
                    }).join(' or ')
                    if (companyFilters) {
                        if (queryFilters && !_.isString(queryFilters)) {
                            queryFilters = formatFiltersToODataQuery(queryFilters);
                        }
                        queryFilters = queryFilters ? `(${queryFilters}) and (${companyFilters})` : `(${companyFilters})`;
                        args[args.length - 3] = queryFilters;
                    }
                }
            }
            else if (method === 'delete') {
                const permissionFilters = this.getObjectEditPermissionFilters(objPm, userSession);
                if (!objPm.allowDelete && _.isEmpty(permissionFilters)) {
                    throw new Error(`no ${method} permission!`);
                }

                let objectPermissionEditFilters = '';
                if (!_.isEmpty(permissionFilters)) {
                    objectPermissionEditFilters = ` or (${permissionFilters.join(' or ')})`
                }

                let id = args[args.length - 2];
                if (!objPm.modifyAllRecords && objPm.modifyCompanyRecords) {
                    let companyFilters = _.map(userSession.companies, function (comp: any) {
                        return `(company_id eq '${comp._id}') or (company_ids eq '${comp._id}')`
                    }).join(' or ')
                    if (companyFilters) {
                        id = { filters: `(_id eq \'${id}\') and (${companyFilters}${objectPermissionEditFilters})` };
                    }
                }
                else if (!objPm.modifyAllRecords && !objPm.modifyCompanyRecords) {
                    id = { filters: `(_id eq \'${id}\') and (owner eq \'${userId}\'${objectPermissionEditFilters})` };
                } else if (objectPermissionEditFilters) {
                    if (_.isString(id)) {
                        id = { filters: `(_id eq \'${id}\') and (${objectPermissionEditFilters})` }
                    }
                    else if (_.isObject(id)) {
                        if (id.filters && !_.isString(id.filters)) {
                            id.filters = formatFiltersToODataQuery(id.filters);
                        }
                        id.filters = id.filters ? `(${id.filters}) and (${objectPermissionEditFilters})` : `(${objectPermissionEditFilters})`;
                    }
                }
                args[args.length - 2] = id;
            }

        }

    }

    /***** get/set *****/
    public get schema(): SteedosSchema {
        return this._schema;
    }

    public get name(): string {
        return this._name;
    }

    public get fields(): Dictionary<SteedosFieldType> {
        return this._fields;
    }

    public get actions(): Dictionary<SteedosActionType> {
        return this._actions;
    }

    public get triggers(): Dictionary<SteedosTriggerType> {
        return this._triggers;
    }

    public get listeners(): Dictionary<SteedosListenerConfig> {
        return this._listeners;
    }
    public set listeners(value: Dictionary<SteedosListenerConfig>) {
        this._listeners = value;
    }

    public get list_views(): Dictionary<SteedosObjectListViewType> {
        return this._list_views;
    }

    public get table_name(): string {
        return this._table_name;
    }

    public get primaryField(): SteedosFieldType {
        return this._fields[this._idFieldName];
    }

    public get primaryFields(): SteedosFieldType[] {
        return this._idFieldNames.map((fieldName) => {
            return this._fields[fieldName]
        });
    }
}

export function getObject(objectName: string, schema?: SteedosSchema) {
    return (schema ? schema : getSteedosSchema()).getObject(objectName);
}
export function getLocalObject(objectName: string, schema?: SteedosSchema) {
    return (schema ? schema : getSteedosSchema()).getLocalObject(objectName);
}
