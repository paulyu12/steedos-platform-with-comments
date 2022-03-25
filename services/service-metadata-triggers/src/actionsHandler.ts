import * as _ from 'underscore';

export const METADATA_TYPE = 'triggers';

export type Trigger = {
    name: string,
    listenTo: string,
    when: string | Array<string>,
    Action: string 
}
export type MetadataObject = {
    nodeID: [string],
    service: {
        name: string,
        version: string | undefined,
        fullName: string
    }, 
    metadata: Trigger
}

function cacherKey(apiName: string, when: string, name: string): string{
    if(!when){
        when = '*'
    }
    if(!name){
        name = '*'
    }
    let key = `$steedos.#${METADATA_TYPE}.${apiName}.${when}.${name}`;
    return key
}

function getDelKey(metadataType, metadataApiName: string){
    return `$steedos.#${metadataType}.${metadataApiName}`;
}

function getPatternTriggerKey( when: string, name: string): string{
    if(!when){
        when = '*'
    }
    if(!name){
        name = '*'
    }
    let key = `$steedos.#${METADATA_TYPE}-pattern.${when}.${name}`;
    return key
}

function isPatternTrigger(data){
    const {listenTo} = data;
    if(listenTo === '*'){
        return true;
    }else if(_.isArray(listenTo)){
        return true;
    }else if(_.isRegExp(listenTo)){
        return true;
    }else if(_.isString(listenTo) && listenTo.startsWith("/")){
        try {
            if(_.isRegExp(eval(listenTo))){
                return true;
            }
        } catch (error) {
            return false
        }
        return false;
    }
    return false;
}

async function registerPatternTrigger(broker, data, meta, item){
    await broker.call('metadata.addServiceMetadata', {data: data}, {meta: Object.assign({}, meta, {metadataType: `${METADATA_TYPE}-pattern`, metadataApiName: `${item}.${data.name}`})})
    await broker.call('metadata.add', {key: getPatternTriggerKey(item, data.name), data: data}, {meta: meta});
}

async function getPatternTriggers(ctx){
    const patternTriggers = [];
    const {objectApiName, when , name } = ctx.params;
    const result = await ctx.broker.call('metadata.filter', {key: getPatternTriggerKey(when, name)}, {meta: ctx.meta});
    
    _.each(result, (item)=>{
        if(item && item.metadata){
            const { metadata } = item
            try {
                if(metadata.listenTo === '*'){
                    patternTriggers.push(item);
                }else if(_.isArray(metadata.listenTo) && _.include(metadata.listenTo, objectApiName)){
                    patternTriggers.push(item);
                }else if(_.isRegExp(metadata.listenTo) && metadata.listenTo.test(objectApiName)){
                    patternTriggers.push(item);
                }else if(_.isString(metadata.listenTo) && metadata.listenTo.startsWith("/")){
                    try {
                        if(_.isRegExp(eval(metadata.listenTo)) && eval(metadata.listenTo).test(objectApiName)){
                            patternTriggers.push(item);
                        }
                    } catch (error) {
                    }
                }
            } catch (error) {
                console.log(`error`, error);
            }
        }
    })
    return patternTriggers;
}

// yupeng: 实际就是将 trigger 对应的 json 写入到缓存中
async function registerTrigger(broker, data, meta){
    let when = []
    if(_.isString(data.when)){
        when.push(data.when);
    }else{
        when = data.when;
    }
    for (const item of when) {
        // yupeng: pattern trigger 就是 listenTo 监听的不只是某一个具体对象，而是根据一定的模式匹配很多对象，对它们都监听
        if(isPatternTrigger(data)){
            await registerPatternTrigger(broker, data, meta, item)
        }else{
            await broker.call('metadata.addServiceMetadata', {data: data}, {meta: Object.assign({}, meta, {metadataType: METADATA_TYPE, metadataApiName: `${data.listenTo}.${item}.${data.name}`})})
            await broker.call('metadata.add', {key: cacherKey(data.listenTo, item, data.name), data: data}, {meta: meta});
        }

        // yupeng: 上面这里是将 trigger 插入到缓存中，以 key 为 net-44924.$METADATA.~packages-standard-objects.objects.object_triggers 的记录为例
        /*
        {
            "nodeIds": [
                "99-1-188-216.lightspeed.tukrga.sbcglobal.net-44924"
            ],
            "metadataType": "objects",
            "metadataApiName": "object_triggers",
            "metadataServiceName": "~packages-standard-objects",
            "metadata": {
                "name": "object_triggers",
                "icon": "apex",
                "label": "Object Triggers",
                "hidden": true,
                "fields": {
                    "name": {
                        "type": "text",
                        "label": "Name",
                        "searchable": true,
                        "index": true,
                        "required": true,
                        "sort_no": 10
                    },
                    "object": {
                        "label": "Object",
                        "type": "master_detail",
                        "reference_to": "objects",
                        "reference_to_field": "name",
                        "required": true,
                        "sort_no": 20,
                        "_optionsFunction": "function anonymous(\n) {\n\n        var _options;\n\n        _options = [];\n\n        _.forEach(Creator.objectsByName, function (o, k) {\n          return _options.push({\n            label: o.label,\n            value: k,\n            icon: o.icon\n          });\n        });\n\n        return _options;\n      \n}"
                    },
                    "when": {
                        "label": "Execution Time Option",
                        "type": "lookup",
                        "required": true,
                        "sort_no": 30,
                        "_optionsFunction": "function anonymous(\n) {\n\n        return [{\n          label: \"新增记录之前\",\n          value: \"beforeInsert\",\n          icon: \"asset_relationship\"\n        }, {\n          label: \"新增记录之后\",\n          value: \"afterInsert\",\n          icon: \"asset_relationship\"\n        }, {\n          label: \"修改记录之前\",\n          value: \"beforeUpdate\",\n          icon: \"asset_relationship\"\n        }, {\n          label: \"修改记录之后\",\n          value: \"afterUpdate\",\n          icon: \"asset_relationship\"\n        }, {\n          label: \"删除记录之前\",\n          value: \"beforeDelete\",\n          icon: \"asset_relationship\"\n        }, {\n          label: \"删除记录之后\",\n          value: \"afterDelete\",\n          icon: \"asset_relationship\"\n        }, {\n          label: \"查下记录之前\",\n          value: \"beforeFind\",\n          icon: \"asset_relationship\"\n        }];\n      \n}"
                    },
                    "is_enable": {
                        "label": "Enable",
                        "type": "boolean",
                        "sort_no": 40
                    },
                    "todo": {
                        "label": "Execute Script  <a target=\"_blank\" href=\"https://developer.steedos.com/developer/object_trigger\">View Help</a>",
                        "type": "textarea",
                        "required": true,
                        "is_wide": true,
                        "sort_no": 50
                    }
                },
                "paging": {
                    "enabled": false
                },
                "list_views": {
                    "all": {
                        "columns": [
                            "name",
                            "object",
                            "when",
                            "is_enable"
                        ],
                        "label": "All",
                        "filter_scope": "space"
                    }
                },
                "permission_set": {
                    "user": {
                        "allowCreate": false,
                        "allowDelete": false,
                        "allowEdit": false,
                        "allowRead": false,
                        "modifyAllRecords": false,
                        "viewAllRecords": false
                    },
                    "admin": {
                        "allowCreate": true,
                        "allowDelete": true,
                        "allowEdit": true,
                        "allowRead": true,
                        "modifyAllRecords": true,
                        "viewAllRecords": true
                    }
                },
                "__filename": "/Users/paulyu/Desktop/Project-aPaaS/steedos-platform/packages/standard-objects/object-database/object_triggers.object.yml",
                "datasource": "meteor",
                "isMain": true,
                "actions": {},
                "fields_serial_number": 60
            }
        }
        */
    }
    return true
}

export const ActionHandlers = {
    async get(ctx: any): Promise<MetadataObject> {
        return ctx.broker.call('metadata.get', {key: cacherKey(ctx.params.objectApiName, ctx.params.when, ctx.params.name)}, {meta: ctx.meta})
    },
    async filter(ctx: any): Promise<Array<MetadataObject>> {
        const result = await ctx.broker.call('metadata.filter', {key: cacherKey(ctx.params.objectApiName, ctx.params.when, ctx.params.name)}, {meta: ctx.meta});
        //get Pattern Triggers
        const patternTriggers = await getPatternTriggers(ctx);
        return result.concat(patternTriggers);
    },
    async add(ctx: any): Promise<boolean>{
        return await registerTrigger(ctx.broker, ctx.params.data, ctx.meta)
    },
    async change(ctx: any): Promise<boolean> {
        const {data, oldData} = ctx.params;
        if(oldData.name != data.name){
            let when = []
            if(_.isString(data.when)){
                when.push(data.when);
            }else{
                when = data.when;
            }
            for (const item of when) {
                await ctx.broker.call('metadata.delete', {key: cacherKey(oldData.listenTo, item, oldData.name)}, {meta: ctx.meta});
            }
        }
        return await registerTrigger(ctx.broker, ctx.params.data, ctx.meta)
    },
    async delete(ctx: any): Promise<boolean> {
        const data = ctx.params.data;
        return await ctx.broker.call('metadata.delete', {key: cacherKey(data.listenTo, data.when, data.name)}, {meta: ctx.meta})
    },
    async verify(ctx: any): Promise<boolean> {
        console.log("verify");
        return true;
    },
    async refresh(ctx){
        const { isClear, metadataApiNames, metadataType } = ctx.params
        if(isClear){
            for await (const metadataApiName of metadataApiNames) {
                try {
                    await ctx.broker.call('metadata.delete', {key: getDelKey(metadataType, metadataApiName)}, {meta: ctx.meta})
                } catch (error) {
                    ctx.broker.logger.info(error.message)
                }
            }
        }
    }
}