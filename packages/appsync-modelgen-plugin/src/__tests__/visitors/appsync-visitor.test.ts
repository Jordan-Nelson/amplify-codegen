import { buildSchema, parse, visit } from 'graphql';
import { directives, scalars } from '../../scalars/supported-directives';
import { CodeGenConnectionType, CodeGenFieldConnectionBelongsTo, CodeGenFieldConnectionHasMany } from '../../utils/process-connections';
import { AppSyncModelVisitor, CodeGenGenerateEnum } from '../../visitors/appsync-visitor';

const buildSchemaWithDirectives = (schema: String) => {
  return buildSchema([schema, directives, scalars].join('\n'));
};

const createAndGenerateVisitor = (schema: string, usePipelinedTransformer: boolean = false) => {
  const ast = parse(schema);
  const builtSchema = buildSchemaWithDirectives(schema);
  const visitor = new AppSyncModelVisitor(
    builtSchema,
    { directives, target: 'general', isTimestampFieldsAdded: true, usePipelinedTransformer: usePipelinedTransformer },
    { generate: CodeGenGenerateEnum.code },
  );
  visit(ast, { leave: visitor });
  visitor.generate();
  return visitor;
};

const createAndGeneratePipelinedTransformerVisitor = (
  schema: string
) => {
  return createAndGenerateVisitor(schema, true);
};

describe('AppSyncModelVisitor', () => {

  it('should support schema with id', () => {
    const schema = /* GraphQL */ `
      type Post @model {
        id: ID!
        title: String!
        content: String!
      }
    `;
    const ast = parse(schema);
    const builtSchema = buildSchemaWithDirectives(schema);
    const visitor = new AppSyncModelVisitor(builtSchema, { directives, target: 'android', generate: CodeGenGenerateEnum.code }, {});
    visit(ast, { leave: visitor });
    expect(visitor.models.Post).toBeDefined();

    const postFields = visitor.models.Post.fields;
    expect(postFields[0].name).toEqual('id');
    expect(postFields[0].type).toEqual('ID');
    expect(postFields[0].isNullable).toEqual(false);
    expect(postFields[0].isList).toEqual(false);
  });

  it('should throw error when schema has id of Non ID type', () => {
    const schema = /* GraphQL */ `
      type Post @model {
        id: String!
        title: String!
        content: String!
      }
    `;
    const ast = parse(schema);
    const builtSchema = buildSchemaWithDirectives(schema);
    const visitor = new AppSyncModelVisitor(builtSchema, { directives, target: 'android', generate: CodeGenGenerateEnum.code }, {});
    expect(() => visit(ast, { leave: visitor })).toThrowError();
  });
  it('should have id as the first field to ensure arity of constructors', () => {
    const schema = /* GraphQL */ `
      type Post @model {
        title: String!
        content: String!
        id: ID!
      }
    `;
    const ast = parse(schema);
    const builtSchema = buildSchemaWithDirectives(schema);
    const visitor = new AppSyncModelVisitor(builtSchema, { directives, target: 'android', generate: CodeGenGenerateEnum.code }, {});
    visit(ast, { leave: visitor });
    const postFields = visitor.models.Post.fields;
    expect(postFields[0].name).toEqual('id');
    expect(postFields[0].type).toEqual('ID');
    expect(postFields[0].isNullable).toEqual(false);
    expect(postFields[0].isList).toEqual(false);
  });

  it('should generate different version if field required attribute is different', () => {
    const schemaNotRequired = /* GraphQL */ `
      type Post @model {
        id: ID!
        title: String
      }
    `;
    const visitorNotRequired = createAndGenerateVisitor(schemaNotRequired);

    const schemaRequired = /* GraphQL */ `
      type Post @model {
        id: ID!
        title: String!
      }
    `;
    const visitorRequired = createAndGenerateVisitor(schemaRequired);

    const notRequiredVersion = (visitorNotRequired as any).computeVersion();
    const requiredVersion = (visitorRequired as any).computeVersion();

    expect(notRequiredVersion).not.toBe(requiredVersion);
  });

  it('should generate different version if field array attribute is different', () => {
    const schemaNoArray = /* GraphQL */ `
      type Post @model {
        id: ID!
        title: String
      }
    `;
    const visitorNoArray = createAndGenerateVisitor(schemaNoArray);

    const schemaWithArray = /* GraphQL */ `
      type Post @model {
        id: ID!
        title: [String]
      }
    `;
    const visitorWithArray = createAndGenerateVisitor(schemaWithArray);

    const noArrayVersion = (visitorNoArray as any).computeVersion();
    const withArrayVersion = (visitorWithArray as any).computeVersion();

    expect(noArrayVersion).not.toBe(withArrayVersion);
  });

  it('should generate different version if field array has required items', () => {
    const schemaNotRequired = /* GraphQL */ `
      type Post @model {
        id: ID!
        title: [String]
      }
    `;
    const visitorNotRequired = createAndGenerateVisitor(schemaNotRequired);

    const schemaRequired = /* GraphQL */ `
      type Post @model {
        id: ID!
        title: [String!]
      }
    `;
    const visitorRequired = createAndGenerateVisitor(schemaRequired);

    const notRequiredVersion = (visitorNotRequired as any).computeVersion();
    const requiredVersion = (visitorRequired as any).computeVersion();

    expect(notRequiredVersion).not.toBe(requiredVersion);
  });

  it('should generate different version if field array changes to required', () => {
    const schemaNotRequired = /* GraphQL */ `
      type Post @model {
        id: ID!
        title: [String]
      }
    `;
    const visitorNotRequired = createAndGenerateVisitor(schemaNotRequired);

    const schemaRequired = /* GraphQL */ `
      type Post @model {
        id: ID!
        title: [String]!
      }
    `;
    const visitorRequired = createAndGenerateVisitor(schemaRequired);

    const notRequiredVersion = (visitorNotRequired as any).computeVersion();
    const requiredVersion = (visitorRequired as any).computeVersion();

    expect(notRequiredVersion).not.toBe(requiredVersion);
  });

  describe(' 2 Way Connection', () => {
    describe('with connection name', () => {
      const schema = /* GraphQL */ `
        type Post @model {
          id: ID!,
          title: String!
          content: String
          comments: [Comment] @connection(name: "PostComment")
        }

        type Comment @model {
          id: ID!,
          comment: String!
          post: Post @connection(name: "PostComment")
        }
      `;
      it('one to many connection', () => {
        const ast = parse(schema);
        const builtSchema = buildSchemaWithDirectives(schema);
        const visitor = new AppSyncModelVisitor(builtSchema, { directives, target: 'android', generate: CodeGenGenerateEnum.code }, {});
        visit(ast, { leave: visitor });
        visitor.generate();
        const commentsField = visitor.models.Post.fields.find(f => f.name === 'comments');
        const postField = visitor.models.Comment.fields.find(f => f.name === 'post');
        expect(commentsField).toBeDefined();
        expect(commentsField!.connectionInfo).toBeDefined();
        const connectionInfo = (commentsField!.connectionInfo as any) as CodeGenFieldConnectionHasMany;
        expect(connectionInfo.kind).toEqual(CodeGenConnectionType.HAS_MANY);
        expect(connectionInfo.associatedWith).toEqual(postField);
        expect(connectionInfo.connectedModel).toEqual(visitor.models.Comment);
      });

      it('many to one connection', () => {
        const ast = parse(schema);
        const builtSchema = buildSchemaWithDirectives(schema);
        const visitor = new AppSyncModelVisitor(builtSchema, { directives, target: 'android', generate: CodeGenGenerateEnum.code }, {});
        visit(ast, { leave: visitor });
        visitor.generate();
        const commentsField = visitor.models.Post.fields.find(f => f.name === 'comments');
        const postField = visitor.models.Comment.fields.find(f => f.name === 'post');
        expect(postField).toBeDefined();
        expect(postField!.connectionInfo).toBeDefined();
        const connectionInfo = (postField!.connectionInfo as any) as CodeGenFieldConnectionBelongsTo;
        expect(connectionInfo.kind).toEqual(CodeGenConnectionType.BELONGS_TO);
        expect(connectionInfo.connectedModel).toEqual(visitor.models.Post);
      });
    });
    describe('connection with fields argument', () => {
      const schema = /* GraphQL */ `
        type Post @model {
          id: ID!,
          title: String!
          content: String
          comments: [Comment] @connection(fields: ["id"])
        }

        type Comment @model {
          id: ID!,
          comment: String!
          postId: ID!
          post: Post @connection(fields: ["postId"])
        }
      `;

      it('one to many connection', () => {
        const ast = parse(schema);
        const builtSchema = buildSchemaWithDirectives(schema);
        const visitor = new AppSyncModelVisitor(builtSchema, { directives, target: 'android', generate: CodeGenGenerateEnum.code }, {});
        visit(ast, { leave: visitor });
        visitor.generate();
        const commentsField = visitor.models.Post.fields.find(f => f.name === 'comments');
        const commentIdField = visitor.models.Post.fields.find(f => f.name === 'id');
        const postField = visitor.models.Comment.fields.find(f => f.name === 'post');
        expect(commentsField).toBeDefined();
        expect(commentsField!.connectionInfo).toBeDefined();
        const connectionInfo = (commentsField!.connectionInfo as any) as CodeGenFieldConnectionHasMany;
        expect(connectionInfo.kind).toEqual(CodeGenConnectionType.HAS_MANY);
        expect(connectionInfo.associatedWith).toEqual(commentIdField);
        expect(connectionInfo.connectedModel).toEqual(visitor.models.Comment);
      });

      it('many to one connection', () => {
        const ast = parse(schema);
        const builtSchema = buildSchemaWithDirectives(schema);
        const visitor = new AppSyncModelVisitor(builtSchema, { directives, target: 'android', generate: CodeGenGenerateEnum.code }, {});
        visit(ast, { leave: visitor });
        visitor.generate();

        const postField = visitor.models.Comment.fields.find(f => f.name === 'post');
        expect(postField).toBeDefined();
        expect(postField!.connectionInfo).toBeDefined();
        const connectionInfo = (postField!.connectionInfo as any) as CodeGenFieldConnectionBelongsTo;
        expect(connectionInfo.kind).toEqual(CodeGenConnectionType.BELONGS_TO);
        expect(connectionInfo.connectedModel).toEqual(visitor.models.Post);
      });
    });
  });

  describe('one way connection', () => {
    it('should not include a comments in Post when comments field does not have connection directive', () => {
      const schema = /* GraphQL */ `
        type Post @model {
          id: ID!,
          title: String!
          content: String
          comments: [Comment]
        }

        type Comment @model {
          id: ID!,
          comment: String!
          post: Post @connection
        }
      `;
      const ast = parse(schema);
      const builtSchema = buildSchemaWithDirectives(schema);
      const visitor = new AppSyncModelVisitor(builtSchema, { directives, target: 'android', generate: CodeGenGenerateEnum.code }, {});
      visit(ast, { leave: visitor });
      visitor.generate();
      const postFields = visitor.models.Post.fields.map(field => field.name);
      expect(postFields).not.toContain('comments');
    });

    it('should not include a post when post field in Comment when post does not have connection directive', () => {
      const schema = /* GraphQL */ `
        type Post @model {
          id: ID!,
          title: String!
          content: String
          comments: [Comment] @connection
        }

        type Comment @model {
          id: ID!,
          comment: String!
          post: Post
        }
      `;
      const ast = parse(schema);
      const builtSchema = buildSchemaWithDirectives(schema);
      const visitor = new AppSyncModelVisitor(builtSchema, { directives, target: 'android', generate: CodeGenGenerateEnum.code }, {});
      visit(ast, { leave: visitor });
      visitor.generate();
      const commentsField = visitor.models.Comment.fields.map(field => field.name);
      expect(commentsField).not.toContain('post');
      expect(commentsField).toContain('postCommentsId'); // because of connection from Post.comments
    });
  });
  describe('auth directive', () => {
    it('should process auth with owner authorization', () => {
      const schema = /* GraphQL */ `
        type Post @searchable @model @auth(rules: [{ allow: owner }]) {
          id: ID!,
          title: String!
          content: String
        }
      `;
      const ast = parse(schema);
      const builtSchema = buildSchemaWithDirectives(schema);
      const visitor = new AppSyncModelVisitor(builtSchema, { directives, target: 'android', generate: CodeGenGenerateEnum.code }, {});
      visit(ast, { leave: visitor });
      visitor.generate();
      const postModel = visitor.models.Post;
      const authDirective = postModel.directives.find(d => d.name === 'auth');
      expect(authDirective).toBeDefined();
      const authRules = authDirective!.arguments.rules;
      expect(authRules).toBeDefined();
      expect(authRules).toHaveLength(1);
      const ownerRule = authRules[0];
      expect(ownerRule).toBeDefined();

      expect(ownerRule.provider).toEqual('userPools');
      expect(ownerRule.identityClaim).toEqual('cognito:username');
      expect(ownerRule.ownerField).toEqual('owner');
      expect(ownerRule.operations).toEqual(['create', 'update', 'delete', 'read']);
    });

    it('should process group with owner authorization', () => {
      const schema = /* GraphQL */ `
        type Post @model @searchable @auth(rules: [{ allow: groups, groups: ["admin", "moderator"] }]) {
          id: ID!,
          title: String!
          content: String
        }
      `;
      const ast = parse(schema);
      const builtSchema = buildSchemaWithDirectives(schema);
      const visitor = new AppSyncModelVisitor(builtSchema, { directives, target: 'android', generate: CodeGenGenerateEnum.code }, {});
      visit(ast, { leave: visitor });
      visitor.generate();
      const postModel = visitor.models.Post;
      const authDirective = postModel.directives.find(d => d.name === 'auth');
      expect(authDirective).toBeDefined();
      const authRules = authDirective!.arguments.rules;
      expect(authRules).toBeDefined();
      expect(authRules).toHaveLength(1);
      const groupRule = authRules[0];
      expect(groupRule).toBeDefined();
      expect(groupRule.provider).toEqual('userPools');
      expect(groupRule.groupClaim).toEqual('cognito:groups');
      expect(groupRule.operations).toEqual(['create', 'update', 'delete', 'read']);
    });

    it('should process field level auth with default owner authorization', () => {
      const schema = /* GraphQL*/ `
        type Employee @model
          @auth(rules: [
              { allow: owner },
              { allow: groups, groups: ["Admins"] }
          ]) {
            id: ID!
            name: String!
            address: String!
            ssn: String @auth(rules: [{allow: owner}])
        }
      `;
      const ast = parse(schema);
      const builtSchema = buildSchemaWithDirectives(schema);
      const visitor = new AppSyncModelVisitor(builtSchema, { directives, target: 'android', generate: CodeGenGenerateEnum.code }, {});
      visit(ast, { leave: visitor });
      visitor.generate();

      const ssnField = visitor.models.Employee.fields.find(f => f.name === 'ssn');
      const authDirective = ssnField?.directives.find(d => d.name === 'auth');
      expect(authDirective).toBeDefined();
      const authRules = authDirective!.arguments.rules;
      expect(authRules).toBeDefined();
      expect(authRules).toHaveLength(1);
      const ownerRule = authRules[0];
      expect(ownerRule).toBeDefined();

      expect(ownerRule.provider).toEqual('userPools');
      expect(ownerRule.identityClaim).toEqual('cognito:username');
      expect(ownerRule.ownerField).toEqual('owner');
      expect(ownerRule.operations).toEqual(['create', 'update', 'delete', 'read']);
    });
  });
  describe('model less type', () => {
    let visitor: AppSyncModelVisitor;
    beforeEach(() => {
      const schema = /* GraphQL */ `
        type Metadata {
          authorName: String!
          tags: [String]
          rating: Int!
        }
      `;
      const ast = parse(schema);
      const builtSchema = buildSchemaWithDirectives(schema);
      visitor = new AppSyncModelVisitor(builtSchema, { directives, target: 'android', generate: CodeGenGenerateEnum.code }, {});
      visit(ast, { leave: visitor });
      visitor.generate();
    });

    it('should support types without model', () => {
      const metadataType = visitor.nonModels.Metadata;

      expect(metadataType).toBeDefined();
      const metadataFields = metadataType.fields;

      expect(metadataFields[0].name).toEqual('authorName');
      expect(metadataFields[0].type).toEqual('String');
      expect(metadataFields[0].isNullable).toEqual(false);
      expect(metadataFields[0].isList).toEqual(false);

      expect(metadataFields[1].name).toEqual('tags');
      expect(metadataFields[1].type).toEqual('String');
      expect(metadataFields[1].isNullable).toEqual(true);
      expect(metadataFields[1].isList).toEqual(true);

      expect(metadataFields[2].name).toEqual('rating');
      expect(metadataFields[2].type).toEqual('Int');
      expect(metadataFields[2].isNullable).toEqual(false);
      expect(metadataFields[2].isList).toEqual(false);
    });
  });
  describe('timestamps for model directive', () => {
    it('should add timestamps fields in implicit cases', () => {
      const schema = /* GraphQL */ `
        type Post @model {
          id: ID!
        }
      `;
      const createdAtFieldObj = {
        name: 'createdAt',
        type: 'AWSDateTime',
        isList: false,
        isNullable: true,
        isReadOnly: true,
      };
      const updatedAtFieldObj = {
        name: 'updatedAt',
        type: 'AWSDateTime',
        isList: false,
        isNullable: true,
        isReadOnly: true,
      };
      const visitor = createAndGenerateVisitor(schema);
      expect(visitor.models.Post).toBeDefined();

      const postFields = visitor.models.Post.fields;
      const createdAtField = postFields.find(field => field.name === 'createdAt');
      expect(createdAtField).toMatchObject(createdAtFieldObj);
      const updatedAtField = postFields.find(field => field.name === 'updatedAt');
      expect(updatedAtField).toMatchObject(updatedAtFieldObj);
    });
    it('should add user defined timestamp fields in model directives', () => {
      const schema = /* GraphQL */ `
        type Post @model(timestamps: { createdAt: "createdOn", updatedAt: "updatedOn" }) {
          id: ID!
        }
      `;
      const createdAtFieldObj = {
        name: 'createdOn',
        type: 'AWSDateTime',
        isList: false,
        isNullable: true,
        isReadOnly: true,
      };
      const updatedAtFieldObj = {
        name: 'updatedOn',
        type: 'AWSDateTime',
        isList: false,
        isNullable: true,
        isReadOnly: true,
      };
      const visitor = createAndGenerateVisitor(schema);
      expect(visitor.models.Post).toBeDefined();

      const postFields = visitor.models.Post.fields;
      const createdAtField = postFields.find(field => field.name === 'createdOn');
      expect(createdAtField).toMatchObject(createdAtFieldObj);
      const updatedAtField = postFields.find(field => field.name === 'updatedOn');
      expect(updatedAtField).toMatchObject(updatedAtFieldObj);
    });
    it('should not override original fields if user define them explicitly in schema', () => {
      const schema = /* GraphQL */ `
        type Post @model {
          id: ID!
          createdAt: AWSDateTime!
          updatedAt: AWSDateTime!
        }
      `;
      const createdAtFieldObj = {
        name: 'createdAt',
        type: 'AWSDateTime',
        isList: false,
        isNullable: false,
      };
      const updatedAtFieldObj = {
        name: 'updatedAt',
        type: 'AWSDateTime',
        isList: false,
        isNullable: false,
      };
      const visitor = createAndGenerateVisitor(schema);
      expect(visitor.models.Post).toBeDefined();

      const postFields = visitor.models.Post.fields;
      const createdAtField = postFields.find(field => field.name === 'createdAt');
      expect(createdAtField).toMatchObject(createdAtFieldObj);
      expect(createdAtField.isReadOnly).not.toBeDefined();
      const updatedAtField = postFields.find(field => field.name === 'updatedAt');
      expect(updatedAtField).toMatchObject(updatedAtFieldObj);
    });
    it('should not override original fields if users define them explicitly in schema and use timestamps params in @model', () => {
      const schema = /* GraphQL */ `
        type Post @model(timestamps: { createdAt: "createdOn", updatedAt: "updatedOn" }) {
          id: ID!
          createdOn: AWSDateTime!
          updatedOn: AWSDateTime!
        }
      `;
      const createdAtFieldObj = {
        name: 'createdOn',
        type: 'AWSDateTime',
        isList: false,
        isNullable: false,
      };
      const updatedAtFieldObj = {
        name: 'updatedOn',
        type: 'AWSDateTime',
        isList: false,
        isNullable: false,
      };
      const visitor = createAndGenerateVisitor(schema);
      expect(visitor.models.Post).toBeDefined();

      const postFields = visitor.models.Post.fields;
      const createdAtField = postFields.find(field => field.name === 'createdOn');
      expect(createdAtField).toMatchObject(createdAtFieldObj);
      expect(createdAtField.isReadOnly).not.toBeDefined();
      const updatedAtField = postFields.find(field => field.name === 'updatedOn');
      expect(updatedAtField).toMatchObject(updatedAtFieldObj);
    });
  });

  describe('manyToMany testing', () => {
    let simpleManyToManySchema;
    let simpleManyModelMap;
    let transformedSimpleManyModelMap;

    beforeEach(() => {
      simpleManyToManySchema = /* GraphQL */ `
          type Human @model {
            governmentID: ID! @primaryKey
            pets: [Animal] @manyToMany(relationName: "PetFriend")
          }
          
          type Animal @model {
            animalTag: ID!
            humanFriend: [Human] @manyToMany(relationName: "PetFriend")
          }
        `;

      simpleManyModelMap = {
        Human: {
          name: 'Human',
          type: 'model',
          directives: [],
          fields: [
            {
              type: 'ID',
              isNullable: false,
              isList: false,
              name: 'governmentID',
              directives: [{ name: 'primaryKey', arguments: {} }]
            },
            {
              type: 'Animal',
              isNullable: true,
              isList: true,
              name: 'pets',
              directives: [{ name: 'manyToMany', arguments: { relationName: 'PetFriend' } }]
            }
          ]
        },
        Animal: {
          name: 'Animal',
          type: 'model',
          directives: [],
          fields: [
            {
              type: 'ID',
              isNullable: false,
              isList: false,
              name: 'animalTag',
              directives: [],
            },
            {
              type: 'Human',
              isNullable: true,
              isList: true,
              name: 'postID',
              directives: [{ name: 'manyToMany', arguments: { relationName: 'PetFriend' } }]
            }
          ],
        }
      };
    });

    transformedSimpleManyModelMap = {
      Human: {
        name: 'Human',
        type: 'model',
        directives: [{name: 'model', arguments: {}}],
        fields: [
          {
            type: 'ID',
            isNullable: false,
            isList: false,
            name: 'governmentID',
            directives: [{ name: 'primaryKey', arguments: {} }]
          },
          {
            type: 'PetFriend',
            isNullable: true,
            isList: true,
            name: 'pets',
            directives: [{ name: 'hasMany', arguments: { fields: ['governmentID'] } }]
          }
        ]
      },
      Animal: {
        name: 'Animal',
        type: 'model',
        directives: [{name: 'model', arguments: {}}],
        fields: [
          {
            type: 'ID',
            isNullable: false,
            isList: false,
            name: 'animalTag',
            directives: [],
          },
          {
            type: 'PetFriend',
            isNullable: true,
            isList: true,
            name: 'postID',
            directives: [{ name: 'hasMany', arguments: { fields: ['id'] } }]
          }
        ],
      },
      PetFriend: {
        name: 'PetFriend',
        type: 'model',
        directives: [{name: 'model', arguments: {}}],
        fields: [
          {
            type: 'ID',
            isNullable: false,
            isList: false,
            name: 'id',
            directives: []
          },
          {
            type: 'ID',
            isNullable: false,
            isList: false,
            name: 'humanID',
            directives: [{ name: 'index', arguments: { name: 'byHuman', sortKeyFields: ['animalID'] } }]
          },
          {
            type: 'ID',
            isNullable: false,
            isList: false,
            name: 'animalID',
            directives: [{ name: 'index', arguments: { name: 'byAnimal', sortKeyFields: ['humanID'] } }]
          },
          {
            type: 'Human',
            isNullable: false,
            isList: false,
            name: 'human',
            directives: [{ name: 'belongsTo', arguments: { fields: ['humanID'] } }]
          },
          {
            type: 'Animal',
            isNullable: false,
            isList: false,
            name: 'animal',
            directives: [{ name: 'belongsTo', arguments: { fields: ['humanID'] } }]
          }
        ]
      }
    };

    it('Should correctly convert the model map of a simple manyToMany', () => {
      const visitor = createAndGeneratePipelinedTransformerVisitor(simpleManyToManySchema);

      expect(visitor.models.Human.fields.length).toEqual(5);
      expect(visitor.models.Human.fields[2].directives[0].name).toEqual('hasMany')
      expect(visitor.models.Human.fields[2].directives[0].arguments.fields.length).toEqual(1)
      expect(visitor.models.Human.fields[2].directives[0].arguments.fields[0]).toEqual('governmentID')
      expect(visitor.models.Human.fields[2].directives[0].arguments.indexName).toEqual('byHuman')
      expect(visitor.models.PetFriend).toBeDefined();
      expect(visitor.models.PetFriend.fields.length).toEqual(5);
      expect(visitor.models.PetFriend.fields[2].directives[0].name).toEqual('belongsTo')
      expect(visitor.models.PetFriend.fields[2].directives[0].arguments.fields.length).toEqual(1)
      expect(visitor.models.PetFriend.fields[2].directives[0].arguments.fields[0]).toEqual('animalID')
      expect(visitor.models.Animal.fields.length).toEqual(5);
      expect(visitor.models.Animal.fields[2].type).toEqual('PetFriend');
      expect(visitor.models.Animal.fields[2].directives.length).toEqual(1);
      expect(visitor.models.Animal.fields[2].directives[0].name).toEqual('hasMany');
      expect(visitor.models.Animal.fields[2].directives[0].arguments.fields.length).toEqual(1)
      expect(visitor.models.Animal.fields[2].directives[0].arguments.fields[0]).toEqual('id')
      expect(visitor.models.Animal.fields[2].directives[0].arguments.indexName).toEqual('byAnimal')
    });
  });
});
